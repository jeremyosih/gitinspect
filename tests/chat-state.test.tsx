import * as React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import type { MessageRow, SessionData } from "@/types/storage"
import { createEmptyUsage } from "@/types/models"

const useLiveQueryMock = vi.fn()
const navigateMock = vi.fn()
const useSearchMock = vi.fn(() => ({}))
const hasActiveTurnMock = vi.fn(() => false)
const useRuntimeSessionMock = vi.fn(() => ({
  abort: vi.fn(),
  send: vi.fn(),
  setModelSelection: vi.fn(),
  setThinkingLevel: vi.fn(),
}))
const toastErrorMock = vi.fn()

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: useLiveQueryMock,
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useSearch: () => useSearchMock(),
}))

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}))

vi.mock("@/hooks/use-runtime-session", () => ({
  useRuntimeSession: () => useRuntimeSessionMock(),
}))

vi.mock("@/hooks/use-session-ownership", () => ({
  useSessionOwnership: () => ({ kind: "owned" }),
}))

vi.mock("@/agent/runtime-client", () => ({
  runtimeClient: {
    hasActiveTurn: hasActiveTurnMock,
    startInitialTurn: vi.fn(async () => {}),
  },
}))

vi.mock("@/sessions/session-notices", () => ({
  reconcileInterruptedSession: vi.fn(async () => ({ kind: "noop" })),
}))

vi.mock("@/sessions/session-actions", () => ({
  createSessionForChat: vi.fn(async () => ({
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id: "session-1",
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    repoSource: undefined,
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  })),
  createSessionForRepo: vi.fn(async () => ({
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id: "session-1",
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    repoSource: undefined,
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  })),
  persistLastUsedSessionSettings: vi.fn(async () => {}),
  resolveProviderDefaults: vi.fn(async () => ({
    model: "gpt-5.1-codex-mini",
    providerGroup: "openai-codex",
  })),
}))

vi.mock("@/repo/settings", () => ({
  normalizeRepoSource: vi.fn(() => undefined),
  resolveRepoSource: vi.fn(async () => undefined),
}))

vi.mock("@/db/schema", () => ({
  touchRepository: vi.fn(async () => {}),
}))

vi.mock("@/components/chat-empty-state", () => ({
  ChatEmptyState: () => <div data-testid="empty-state">empty</div>,
}))

vi.mock("@/components/chat-composer", () => ({
  ChatComposer: () => <div data-testid="composer">composer</div>,
}))

vi.mock("@/components/repo-combobox", () => ({
  RepoCombobox: React.forwardRef(
    ({
      repoSource,
    }: {
      repoSource?: { owner: string; repo: string }
    }, _ref) => (
      <div data-testid="repo-combobox">
        {repoSource ? `${repoSource.owner}/${repoSource.repo}` : "none"}
      </div>
    )
  ),
}))

vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationScrollButton: () => null,
}))

vi.mock("@/components/ui/progressive-blur", () => ({
  ProgressiveBlur: () => null,
}))

vi.mock("@/components/chat-message", () => ({
  ChatMessage: () => null,
}))

vi.mock("@/components/chat-adapter", () => ({
  getAssistantText: () => "",
  getFoldedToolResultIds: () => new Set<string>(),
}))

function buildSession(
  overrides: Partial<SessionData> = {}
): { kind: "active"; messages: Array<MessageRow>; session: SessionData } {
  return {
    kind: "active",
    messages: [],
    session: {
      cost: 0,
      createdAt: "2026-03-24T12:00:00.000Z",
      error: undefined,
      id: "session-1",
      isStreaming: false,
      messageCount: 0,
      model: "gpt-5.1-codex-mini",
      preview: "",
      provider: "openai-codex",
      providerGroup: "openai-codex",
      repoSource: undefined,
      thinkingLevel: "medium",
      title: "New chat",
      updatedAt: "2026-03-24T12:00:00.000Z",
      usage: createEmptyUsage(),
      ...overrides,
    },
  }
}

function mockChatQueries(options: {
  defaults: {
    model: string
    providerGroup: string
    thinkingLevel: string
  }
  loadedSessionState:
    | { kind: "none" | "missing" }
    | { kind: "active"; messages: Array<MessageRow>; session: SessionData }
  sessionRuntime?: unknown
}) {
  useLiveQueryMock.mockImplementation(() => {
    const callIndex = useLiveQueryMock.mock.calls.length

    switch ((callIndex - 1) % 3) {
      case 0:
        return options.loadedSessionState
      case 1:
        return options.sessionRuntime
      default:
        return options.defaults
    }
  })
}

describe("Chat state", () => {
  beforeEach(() => {
    navigateMock.mockReset()
    useLiveQueryMock.mockReset()
    hasActiveTurnMock.mockReset()
    hasActiveTurnMock.mockReturnValue(false)
    useRuntimeSessionMock.mockClear()
    toastErrorMock.mockReset()
  })

  it("shows the normal empty state when the active session has no messages", async () => {
    const session = buildSession()
    const defaults = {
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      thinkingLevel: "medium",
    }
    mockChatQueries({
      defaults,
      loadedSessionState: session,
    })

    const { Chat } = await import("@/components/chat")

    render(<Chat sessionId="session-1" />)

    expect(screen.getByTestId("empty-state")).toBeTruthy()
    expect(screen.queryByText("Starting session...")).toBeNull()
    expect(screen.getByTestId("composer")).toBeTruthy()
  })

  it("uses the persisted session repo source for the repo combobox", async () => {
    const session = buildSession({
      repoSource: {
        owner: "acme",
        ref: "main",
        repo: "demo",
      },
    })
    const defaults = {
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      thinkingLevel: "medium",
    }
    mockChatQueries({
      defaults,
      loadedSessionState: session,
    })

    const { Chat } = await import("@/components/chat")

    render(<Chat sessionId="session-1" />)

    expect(screen.getByTestId("repo-combobox").textContent).toBe("acme/demo")
  })

  it("shows a streaming status row when the assistant has not rendered yet", async () => {
    hasActiveTurnMock.mockReturnValue(true)

    const session = buildSession({
      isStreaming: true,
      messageCount: 1,
    })
    session.messages = [
      {
        content: [{ text: "hello", type: "text" }],
        id: "message-1",
        role: "user",
        sessionId: "session-1",
        status: "completed",
        timestamp: 1,
      } as MessageRow,
    ]

    const defaults = {
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      thinkingLevel: "medium",
    }
    mockChatQueries({
      defaults,
      loadedSessionState: session,
    })

    const { Chat } = await import("@/components/chat")

    render(<Chat sessionId="session-1" />)

    expect(screen.getByRole("status").textContent).toContain(
      "Assistant is streaming..."
    )
  })

  it("toasts new async system errors without replaying existing notices", async () => {
    let loadedSessionState = buildSession()
    const defaults = {
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      thinkingLevel: "medium",
    }

    mockChatQueries({
      defaults,
      loadedSessionState,
    })

    const { Chat } = await import("@/components/chat")
    const { rerender } = render(<Chat sessionId="session-1" />)

    expect(toastErrorMock).not.toHaveBeenCalled()

    loadedSessionState = {
      ...loadedSessionState,
      messages: [
        {
          fingerprint: "provider_rate_limit:429 Too Many Requests",
          id: "system-1",
          kind: "provider_rate_limit",
          message: "429 Too Many Requests",
          role: "system",
          sessionId: "session-1",
          severity: "error",
          source: "provider",
          status: "completed",
          timestamp: 2,
        } as MessageRow,
      ],
    }

    mockChatQueries({
      defaults,
      loadedSessionState,
    })

    rerender(<Chat sessionId="session-1" />)

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "The selected provider is rate limited right now. Wait a bit or switch to another model."
      )
    })

    rerender(<Chat sessionId="session-1" />)

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledTimes(1)
    })
  })
})
