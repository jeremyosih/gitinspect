/* eslint-disable @typescript-eslint/consistent-type-imports, @typescript-eslint/require-await */
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { RepoSource } from "@/types/storage"
import type {
  RuntimeMutationResult,
  RuntimeWorkerApi,
  WorkerMode,
} from "@/agent/runtime-worker-types"
import { wrap, type Remote } from "comlink"

const sharedWorkerSupported =
  typeof window !== "undefined" && "SharedWorker" in window

function createWorkerApi(): { api: RuntimeWorkerApi; mode: WorkerMode } {
  if (typeof window === "undefined") {
    throw new Error("Worker runtime requires a browser environment")
  }

  if (sharedWorkerSupported) {
    const worker = new SharedWorker(
      new URL("./runtime-worker", import.meta.url),
      { name: "gitinspect-runtime", type: "module" }
    )
    return {
      api: wrap<RuntimeWorkerApi>(worker.port),
      mode: "shared",
    }
  }

  const worker = new Worker(
    new URL("./runtime-worker", import.meta.url),
    { name: "gitinspect-runtime", type: "module" }
  )
  return {
    api: wrap<RuntimeWorkerApi>(worker),
    mode: "dedicated",
  }
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
      const result = createWorkerApi()
      this.api = result.api
    })().catch((error) => {
      this.connectError =
        error instanceof Error ? error : new Error(String(error))
      this.connectPromise = undefined
      throw error
    })

    return await this.connectPromise
  }

  async ensureSession(sessionId: string): Promise<boolean> {
    await this.ensureConnected()
    return (await this.api?.ensureSession(sessionId)) ?? false
  }

  async send(sessionId: string, content: string): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.send(sessionId, content)) ?? {
      error: "missing-session",
      ok: false,
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    await this.api?.abort(sessionId)
  }

  async releaseSession(sessionId: string): Promise<void> {
    await this.ensureConnected()
    await this.api?.releaseSession(sessionId)
  }

  async refreshGithubToken(
    sessionId: string
  ): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.refreshGithubToken(sessionId)) ?? {
      error: "missing-session",
      ok: false,
    }
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.setModelSelection(
      sessionId,
      providerGroup,
      modelId
    )) ?? {
      error: "missing-session",
      ok: false,
    }
  }

  async setRepoSource(
    sessionId: string,
    repoSource?: RepoSource
  ): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.setRepoSource(sessionId, repoSource)) ?? {
      error: "missing-session",
      ok: false,
    }
  }

  async setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.setThinkingLevel(sessionId, thinkingLevel)) ?? {
      error: "missing-session",
      ok: false,
    }
  }
}

export const runtimeClient = new RuntimeClient()
