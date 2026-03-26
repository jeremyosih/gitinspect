import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RuntimeWorkerApi } from "@/agent/runtime-worker-types"

type WorkerApiStub = RuntimeWorkerApi & {
  abort: ReturnType<typeof vi.fn<(sessionId: string) => Promise<void>>>
  ensureSession: ReturnType<typeof vi.fn<(sessionId: string) => Promise<boolean>>>
  refreshGithubToken: ReturnType<typeof vi.fn<(sessionId: string) => Promise<void>>>
  releaseSession: ReturnType<typeof vi.fn<(sessionId: string) => Promise<void>>>
  send: ReturnType<typeof vi.fn<(sessionId: string, content: string) => Promise<void>>>
  setModelSelection: ReturnType<
    typeof vi.fn<
      (
        sessionId: string,
        providerGroup: "openai-codex",
        modelId: string
      ) => Promise<void>
    >
  >
  setThinkingLevel: ReturnType<
    typeof vi.fn<
      (
        sessionId: string,
        thinkingLevel: "medium" | "off" | "high"
      ) => Promise<void>
    >
  >
}

const wrapMock = vi.fn<() => RuntimeWorkerApi>()

vi.mock("comlink", () => ({
  wrap: wrapMock,
}))

function createApiStub(): WorkerApiStub {
  return {
    abort: vi.fn(async (_sessionId: string) => {}),
    ensureSession: vi.fn(async (_sessionId: string) => true),
    refreshGithubToken: vi.fn(async (_sessionId: string) => {}),
    releaseSession: vi.fn(async (_sessionId: string) => {}),
    send: vi.fn(async (_sessionId: string, _content: string) => {}),
    setModelSelection: vi.fn(
      async (
        _sessionId: string,
        _providerGroup: "openai-codex",
        _modelId: string
      ) => {}
    ),
    setThinkingLevel: vi.fn(
      async (
        _sessionId: string,
        _thinkingLevel: "medium" | "off" | "high"
      ) => {}
    ),
  }
}

function installWindow(sharedWorkerAvailable: boolean) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  })

  if (sharedWorkerAvailable) {
    class SharedWorkerStub {
      port = { stub: "shared-port" }
    }

    Object.defineProperty(globalThis, "SharedWorker", {
      configurable: true,
      value: SharedWorkerStub,
    })
  } else {
    Object.defineProperty(globalThis, "SharedWorker", {
      configurable: true,
      value: undefined,
    })
  }

  class WorkerStub {}

  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: WorkerStub,
  })
}

describe("RuntimeClient", () => {
  beforeEach(() => {
    vi.resetModules()
    wrapMock.mockReset()
  })

  it("uses SharedWorker when available", async () => {
    const api = createApiStub()
    installWindow(true)
    wrapMock.mockReturnValue(api)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await client.ensureConnected()

    expect(wrapMock).toHaveBeenCalledTimes(1)
    expect(api.ensureSession).not.toHaveBeenCalled()
  })

  it("falls back to Worker when SharedWorker is unavailable", async () => {
    const api = createApiStub()
    installWindow(false)
    wrapMock.mockReturnValue(api)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await client.ensureConnected()

    expect(wrapMock).toHaveBeenCalledTimes(1)
  })

  it("normalizes failed ensureSession to missing-session for session mutations", async () => {
    const api = createApiStub()
    installWindow(true)
    api.ensureSession.mockResolvedValue(false)
    wrapMock.mockReturnValue(api)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await expect(client.send("missing", "hello")).rejects.toMatchObject({
      code: "missing-session",
      name: "MissingSessionRuntimeError",
    })
    expect(api.send).not.toHaveBeenCalled()
  })

  it("uses the same missing-session fallback across session mutations", async () => {
    const api = createApiStub()
    installWindow(true)
    api.ensureSession.mockResolvedValue(false)
    wrapMock.mockReturnValue(api)

    const { RuntimeClient } = await import("@/agent/runtime-client")
    const client = new RuntimeClient()

    await expect(
      client.setModelSelection(
        "missing",
        "openai-codex",
        "gpt-5.1-codex-mini"
      )
    ).rejects.toMatchObject({
      code: "missing-session",
      name: "MissingSessionRuntimeError",
    })
    await expect(
      client.refreshGithubToken("missing")
    ).rejects.toMatchObject({
      code: "missing-session",
      name: "MissingSessionRuntimeError",
    })
    await expect(
      client.setThinkingLevel("missing", "medium")
    ).rejects.toMatchObject({
      code: "missing-session",
      name: "MissingSessionRuntimeError",
    })
  })
})
