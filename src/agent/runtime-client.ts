/* eslint-disable @typescript-eslint/require-await */
import { wrap } from "comlink"
import {
  MissingSessionRuntimeError,
  reviveRuntimeCommandError,
} from "@/agent/runtime-command-errors"
import type { RuntimeWorkerApi } from "@/agent/runtime-worker-types"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"

const sharedWorkerSupported =
  typeof window !== "undefined" && "SharedWorker" in window

function createWorkerApi(): RuntimeWorkerApi {
  if (typeof window === "undefined") {
    throw new Error("Worker runtime requires a browser environment")
  }

  if (sharedWorkerSupported) {
    const worker = new SharedWorker(
      new URL("./runtime-worker", import.meta.url),
      { name: "gitinspect-runtime", type: "module" }
    )
    return wrap<RuntimeWorkerApi>(worker.port)
  }

  const worker = new Worker(
    new URL("./runtime-worker", import.meta.url),
    { name: "gitinspect-runtime", type: "module" }
  )
  return wrap<RuntimeWorkerApi>(worker)
}

export class RuntimeClient {
  private api?: RuntimeWorkerApi
  private connectError?: Error
  private connectPromise?: Promise<void>

  async ensureConnected(): Promise<void> {
    if (this.connectPromise) {
      return await this.connectPromise
    }

    if (this.connectError) {
      throw this.connectError
    }

    this.connectPromise = (async () => {
      this.api = createWorkerApi()
    })().catch((error) => {
      this.connectError =
        error instanceof Error ? error : new Error(String(error))
      this.connectPromise = undefined
      throw error
    })

    return await this.connectPromise
  }

  private async call<T>(
    invoke: (api: RuntimeWorkerApi) => Promise<T>
  ): Promise<T> {
    await this.ensureConnected()

    if (!this.api) {
      throw new Error("Runtime connection unavailable")
    }

    try {
      return await invoke(this.api)
    } catch (error) {
      if (error instanceof Error) {
        throw reviveRuntimeCommandError(error)
      }

      throw error
    }
  }

  private async callSession(
    sessionId: string,
    invoke: (api: RuntimeWorkerApi) => Promise<void>
  ): Promise<void> {
    await this.call(async (api) => {
      const exists = await api.ensureSession(sessionId)

      if (!exists) {
        throw new MissingSessionRuntimeError(sessionId)
      }

      await invoke(api)
    })
  }

  private async callSessionAction(
    sessionId: string,
    invoke: (api: RuntimeWorkerApi) => Promise<void>
  ): Promise<void> {
    await this.call(async (api) => {
      const exists = await api.ensureSession(sessionId)

      if (!exists) {
        return
      }

      await invoke(api)
    })
  }

  async ensureSession(sessionId: string): Promise<boolean> {
    return await this.call(async (api) => await api.ensureSession(sessionId))
  }

  async send(sessionId: string, content: string): Promise<void> {
    await this.callSession(
      sessionId,
      async (api) => await api.send(sessionId, content)
    )
  }

  async abort(sessionId: string): Promise<void> {
    await this.callSessionAction(
      sessionId,
      async (api) => await api.abort(sessionId)
    )
  }

  async releaseSession(sessionId: string): Promise<void> {
    await this.call(async (api) => await api.releaseSession(sessionId))
  }

  async refreshGithubToken(
    sessionId: string
  ): Promise<void> {
    await this.callSession(
      sessionId,
      async (api) => await api.refreshGithubToken(sessionId)
    )
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void> {
    await this.callSession(
      sessionId,
      async (api) =>
        await api.setModelSelection(sessionId, providerGroup, modelId)
    )
  }

  async setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<void> {
    await this.callSession(
      sessionId,
      async (api) => await api.setThinkingLevel(sessionId, thinkingLevel)
    )
  }
}

export const runtimeClient = new RuntimeClient()
