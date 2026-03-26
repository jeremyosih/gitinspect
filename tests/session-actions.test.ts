import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SessionData } from "@/types/storage"
import { createEmptyUsage } from "@/types/models"

const deleteSession = vi.fn(async () => {})
const getSetting = vi.fn()
const listProviderKeys = vi.fn()
const setSetting = vi.fn(async () => {})
const persistSessionSnapshot = vi.fn(async () => {})
const createSession = vi.fn()
const releaseSession = vi.fn(async () => {})

vi.mock("@/db/schema", () => ({
  deleteSession,
  getSetting,
  listProviderKeys,
  setSetting,
}))

vi.mock("@/sessions/session-service", () => ({
  createSession,
  persistSessionSnapshot,
}))

vi.mock("@/agent/runtime-client", () => ({
  runtimeClient: {
    releaseSession,
  },
}))

vi.mock("@/models/catalog", () => ({
  getCanonicalProvider: (providerGroup: string) => providerGroup,
  getConnectedProviders: () => [],
  getDefaultModelForGroup: () => ({
    id: "gpt-5.1-codex-mini",
  }),
  getDefaultProviderGroup: (provider: string) => provider,
  getPreferredProviderGroup: () => "openai-codex",
  getProviderGroups: () => ["opencode-free", "openai-codex"],
  getVisibleProviderGroups: () => ["opencode-free", "openai-codex"],
  hasModelForGroup: () => true,
  isProviderGroupId: (value: string) =>
    value === "opencode-free" || value === "openai-codex",
}))

function buildSession(
  id: string,
  overrides: Partial<SessionData> = {}
): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-23T12:00:00.000Z",
    error: undefined,
    id,
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    repoSource: undefined,
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-23T12:00:00.000Z",
    usage: createEmptyUsage(),
    ...overrides,
  }
}

describe("session-actions", () => {
  beforeEach(() => {
    createSession.mockReset()
    deleteSession.mockReset()
    getSetting.mockReset()
    listProviderKeys.mockReset()
    persistSessionSnapshot.mockReset()
    releaseSession.mockReset()
    setSetting.mockReset()
  })

  it("builds chat navigation for non-repo sessions", async () => {
    const { sessionDestination } = await import("@/sessions/session-actions")

    expect(
      sessionDestination({
        id: "session-1",
        repoSource: undefined,
      })
    ).toEqual({
      to: "/chat",
    })
  })

  it("builds repo navigation for repo-backed sessions", async () => {
    const { sessionDestination } = await import("@/sessions/session-actions")

    expect(
      sessionDestination({
        id: "session-2",
        repoSource: {
          owner: "acme",
          ref: "main",
          repo: "demo",
        },
      })
    ).toEqual({
      params: {
        _splat: "main",
        owner: "acme",
        repo: "demo",
      },
      to: "/$owner/$repo/$",
    })
  })

  it("creates empty chat sessions from provider defaults", async () => {
    const created = buildSession("session-new")
    createSession.mockReturnValue(created)
    getSetting.mockResolvedValue(undefined)
    listProviderKeys.mockResolvedValue([])

    const { createSessionForChat } = await import("@/sessions/session-actions")
    const session = await createSessionForChat()

    expect(createSession).toHaveBeenCalledWith({
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      repoSource: undefined,
    })
    expect(persistSessionSnapshot).toHaveBeenCalledWith(created)
    expect(session.id).toBe("session-new")
  })

  it("creates repo sessions with the current repo context", async () => {
    const created = buildSession("session-repo", {
      repoSource: {
        owner: "acme",
        ref: "dev",
        repo: "demo",
      },
    })
    createSession.mockReturnValue(created)
    getSetting.mockResolvedValue(undefined)
    listProviderKeys.mockResolvedValue([])

    const { createSessionForRepo } = await import("@/sessions/session-actions")
    const session = await createSessionForRepo({
      owner: "acme",
      ref: "dev",
      repo: "demo",
    })

    expect(createSession).toHaveBeenCalledWith({
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      repoSource: {
        owner: "acme",
        ref: "dev",
        repo: "demo",
      },
    })
    expect(session.repoSource?.ref).toBe("dev")
  })

  it("persists last-used session settings", async () => {
    const { persistLastUsedSessionSettings } = await import(
      "@/sessions/session-actions"
    )

    await persistLastUsedSessionSettings({
      model: "gpt-5.1-codex-mini",
      provider: "openai-codex",
      providerGroup: "openai-codex",
    })

    expect(setSetting).toHaveBeenCalledWith(
      "last-used-model",
      "gpt-5.1-codex-mini"
    )
    expect(setSetting).toHaveBeenCalledWith(
      "last-used-provider",
      "openai-codex"
    )
    expect(setSetting).toHaveBeenCalledWith(
      "last-used-provider-group",
      "openai-codex"
    )
  })

  it("deletes the session and falls back to a sibling", async () => {
    const { deleteSessionAndResolveNext } = await import(
      "@/sessions/session-actions"
    )

    const sibling = buildSession("session-next")
    const result = await deleteSessionAndResolveNext({
      sessionId: "session-current",
      siblingSessions: [buildSession("session-current"), sibling],
    })

    expect(releaseSession).toHaveBeenCalledWith("session-current")
    expect(deleteSession).toHaveBeenCalledWith("session-current")
    expect(result).toEqual({
      nextSession: {
        id: "session-next",
        repoSource: undefined,
      },
    })
  })

  it("clears the selection when no fallback session remains", async () => {
    const { deleteSessionAndResolveNext } = await import(
      "@/sessions/session-actions"
    )

    const result = await deleteSessionAndResolveNext({
      sessionId: "session-current",
      siblingSessions: [buildSession("session-current")],
    })

    expect(result).toEqual({
      nextSession: undefined,
    })
  })
})
