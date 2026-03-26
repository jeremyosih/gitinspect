import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  BusyRuntimeError,
  MissingSessionRuntimeError,
} from "@/agent/runtime-command-errors"
import type { MessageRow, SessionData } from "@/types/storage"
import { createEmptyUsage } from "@/types/models"

const getGithubPersonalAccessToken = vi.fn(async () => "ghp_test")
const loadSessionWithMessages = vi.fn(
  async (): Promise<
    { messages: Array<MessageRow>; session: SessionData } | undefined
  > =>
    undefined
)

type AgentHostInstance = {
  abort: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  isBusy: ReturnType<typeof vi.fn<() => boolean>>
  prompt: ReturnType<typeof vi.fn<(content: string) => Promise<void>>>
  refreshGithubToken: ReturnType<typeof vi.fn<() => Promise<void>>>
  setModelSelection: ReturnType<
    typeof vi.fn<
      (providerGroup: SessionData["providerGroup"], modelId: string) => Promise<void>
    >
  >
  setThinkingLevel: ReturnType<
    typeof vi.fn<(thinkingLevel: SessionData["thinkingLevel"]) => Promise<void>>
  >
}

const agentHostInstances: Array<AgentHostInstance> = []

vi.mock("@/repo/github-token", () => ({
  getGithubPersonalAccessToken,
}))

vi.mock("@/sessions/session-service", () => ({
  loadSessionWithMessages,
}))

vi.mock("@/agent/agent-host", () => ({
  AgentHost: class {
    abort = vi.fn()
    dispose = vi.fn()
    isBusy = vi.fn(() => false)
    prompt = vi.fn(async (_content: string) => {})
    refreshGithubToken = vi.fn(async () => {})
    setModelSelection = vi.fn(
      async (
        _providerGroup: SessionData["providerGroup"],
        _modelId: string
      ) => {}
    )
    setThinkingLevel = vi.fn(
      async (_thinkingLevel: SessionData["thinkingLevel"]) => {}
    )

    constructor() {
      agentHostInstances.push(this)
    }
  },
}))

function createSession(id = "session-1"): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id,
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  }
}

describe("SessionRuntimeRegistry", () => {
  beforeEach(() => {
    agentHostInstances.length = 0
    getGithubPersonalAccessToken.mockReset()
    getGithubPersonalAccessToken.mockResolvedValue("ghp_test")
    loadSessionWithMessages.mockReset()
  })

  it("creates a host when a persisted session exists", async () => {
    const session = createSession()
    loadSessionWithMessages.mockResolvedValue({
      messages: [],
      session,
    })

    const { SessionRuntimeRegistry } = await import(
      "@/agent/session-runtime-registry"
    )
    const registry = new SessionRuntimeRegistry()

    await expect(registry.ensureSession(session.id)).resolves.toBe(true)
    expect(agentHostInstances).toHaveLength(1)
  })

  it("returns false when ensureSession cannot load the session", async () => {
    loadSessionWithMessages.mockResolvedValue(undefined)

    const { SessionRuntimeRegistry } = await import(
      "@/agent/session-runtime-registry"
    )
    const registry = new SessionRuntimeRegistry()

    await expect(registry.ensureSession("missing")).resolves.toBe(false)
    expect(agentHostInstances).toHaveLength(0)
  })

  it("returns busy when send is called on a busy host", async () => {
    const session = createSession()
    loadSessionWithMessages.mockResolvedValue({
      messages: [],
      session,
    })

    const { SessionRuntimeRegistry } = await import(
      "@/agent/session-runtime-registry"
    )
    const registry = new SessionRuntimeRegistry()
    await registry.ensureSession(session.id)
    agentHostInstances[0].isBusy.mockReturnValue(true)

    await expect(registry.send(session.id, "hello")).rejects.toBeInstanceOf(
      BusyRuntimeError
    )
  })

  it("returns busy when setModelSelection is called on a busy host", async () => {
    const session = createSession()
    loadSessionWithMessages.mockResolvedValue({
      messages: [],
      session,
    })

    const { SessionRuntimeRegistry } = await import(
      "@/agent/session-runtime-registry"
    )
    const registry = new SessionRuntimeRegistry()
    await registry.ensureSession(session.id)
    agentHostInstances[0].isBusy.mockReturnValue(true)

    await expect(
      registry.setModelSelection(session.id, "openai-codex", "gpt-5.1-codex-mini")
    ).rejects.toBeInstanceOf(BusyRuntimeError)
  })

  it("returns missing-session when refreshGithubToken cannot load the session", async () => {
    loadSessionWithMessages.mockResolvedValue(undefined)

    const { SessionRuntimeRegistry } = await import(
      "@/agent/session-runtime-registry"
    )
    const registry = new SessionRuntimeRegistry()

    await expect(registry.refreshGithubToken("missing")).rejects.toBeInstanceOf(
      MissingSessionRuntimeError
    )
  })

  it("disposes and removes a released host", async () => {
    const session = createSession()
    loadSessionWithMessages.mockResolvedValue({
      messages: [],
      session,
    })

    const { SessionRuntimeRegistry } = await import(
      "@/agent/session-runtime-registry"
    )
    const registry = new SessionRuntimeRegistry()

    await registry.ensureSession(session.id)
    const firstHost = agentHostInstances[0]

    registry.releaseSession(session.id)
    expect(firstHost.dispose).toHaveBeenCalledTimes(1)

    await registry.ensureSession(session.id)
    expect(agentHostInstances).toHaveLength(2)
  })
})
