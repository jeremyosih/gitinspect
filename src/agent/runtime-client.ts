import { wrap } from "comlink"
import type { Remote } from "comlink"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { SessionWorkerApi } from "@/agent/runtime-worker-types"
import {
  MissingSessionRuntimeError,
  reviveRuntimeCommandError,
} from "@/agent/runtime-command-errors"
import { logRuntimeDebug } from "@/lib/runtime-debug"

const sharedWorkerSupported =
  typeof window !== "undefined" && "SharedWorker" in window

interface WorkerHandle {
  worker: SharedWorker | Worker
  api: Remote<SessionWorkerApi>
  workerType: "dedicated" | "shared"
}

function isWorkerTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()

  return (
    message.includes("disposed") ||
    message.includes("closed") ||
    message.includes("port") ||
    message.includes("worker")
  )
}

export class RuntimeClient {
  private readonly workers = new Map<string, WorkerHandle>()
  private readonly initPromises = new Map<
    string,
    Promise<WorkerHandle | undefined>
  >()

  private createWorker(sessionId: string): WorkerHandle {
    if (typeof window === "undefined") {
      throw new Error("Runtime requires a browser environment")
    }

    const url = new URL("./runtime-worker", import.meta.url)
    const opts = {
      name: `gitinspect-session-${sessionId}`,
      type: "module" as const,
    }

    if (sharedWorkerSupported) {
      try {
        const worker = new SharedWorker(url, opts)
        return {
          worker,
          api: wrap<SessionWorkerApi>(worker.port),
          workerType: "shared",
        }
      } catch (error) {
        console.warn("[gitinspect:first-send] shared_worker_unavailable", {
          error,
          sessionId,
        })
      }
    }

    const worker = new Worker(url, opts)
    return {
      worker,
      api: wrap<SessionWorkerApi>(worker),
      workerType: "dedicated",
    }
  }

  private terminateHandle(handle: WorkerHandle): void {
    if ("port" in handle.worker) {
      handle.worker.port.close()
    } else {
      handle.worker.terminate()
    }
  }

  private async getOrCreate(
    sessionId: string
  ): Promise<WorkerHandle | undefined> {
    const existing = this.workers.get(sessionId)

    if (existing) {
      return existing
    }

    let pending = this.initPromises.get(sessionId)

    if (pending) {
      return pending
    }

    pending = (async () => {
      try {
        const handle = this.createWorker(sessionId)
        logRuntimeDebug("worker_init_started", {
          sessionId,
          workerType: handle.workerType,
        })
        const exists = await handle.api.init(sessionId)

        if (!exists) {
          this.terminateHandle(handle)
          return undefined
        }

        logRuntimeDebug("worker_init_completed", {
          sessionId,
          workerType: handle.workerType,
        })
        this.workers.set(sessionId, handle)
        return handle
      } finally {
        this.initPromises.delete(sessionId)
      }
    })()

    this.initPromises.set(sessionId, pending)
    return pending
  }

  private async call<T>(
    sessionId: string,
    invoke: (api: Remote<SessionWorkerApi>) => Promise<T>
  ): Promise<T> {
    const handle = await this.getOrCreate(sessionId)

    if (!handle) {
      throw new MissingSessionRuntimeError(sessionId)
    }

    try {
      return await invoke(handle.api)
    } catch (error) {
      if (isWorkerTransportError(error)) {
        this.terminateHandle(handle)
        this.workers.delete(sessionId)
      }

      if (error instanceof Error) {
        throw reviveRuntimeCommandError(error, sessionId)
      }

      throw error
    }
  }

  async ensureSession(sessionId: string): Promise<boolean> {
    const handle = await this.getOrCreate(sessionId)
    return handle !== undefined
  }

  async send(sessionId: string, content: string): Promise<void> {
    logRuntimeDebug("runtime_send_started", {
      contentLength: content.trim().length,
      sessionId,
    })
    try {
      await this.call(sessionId, async (api) => await api.send(content))
      logRuntimeDebug("runtime_send_completed", { sessionId })
    } catch (error) {
      logRuntimeDebug("runtime_send_failed", {
        message: error instanceof Error ? error.message : String(error),
        sessionId,
      })
      throw error
    }
  }

  async abort(sessionId: string): Promise<void> {
    const handle = this.workers.get(sessionId)

    if (!handle) {
      return
    }

    try {
      await handle.api.abort()
    } catch (error) {
      if (isWorkerTransportError(error)) {
        this.terminateHandle(handle)
        this.workers.delete(sessionId)
      }

      if (error instanceof Error) {
        throw reviveRuntimeCommandError(error, sessionId)
      }

      throw error
    }
  }

  async releaseSession(sessionId: string): Promise<void> {
    const handle = this.workers.get(sessionId)

    if (!handle) {
      return
    }

    try {
      await handle.api.dispose()
    } catch {
      // Best-effort teardown; worker may already be gone.
    }

    this.terminateHandle(handle)
    this.workers.delete(sessionId)
  }

  async refreshGithubToken(sessionId: string): Promise<void> {
    await this.call(sessionId, async (api) => await api.refreshGithubToken())
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void> {
    await this.call(sessionId, async (api) =>
      api.setModelSelection(providerGroup, modelId)
    )
  }

  async setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<void> {
    await this.call(sessionId, async (api) =>
      api.setThinkingLevel(thinkingLevel)
    )
  }
}

export const runtimeClient = new RuntimeClient()
