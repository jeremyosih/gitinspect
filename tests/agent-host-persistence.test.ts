import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core"
import type { Message } from "@mariozechner/pi-ai"
import type {
  AssistantMessage,
  SystemMessage,
  ToolResultMessage,
} from "@/types/chat"
import type { MessageRow, SessionData } from "@/types/storage"
import { GitHubFsError } from "@/repo/github-fs"
import { createEmptyUsage } from "@/types/models"

const getSessionMessages = vi.fn(async (): Promise<Array<MessageRow>> => [])
const putMessage = vi.fn(async (_message: MessageRow): Promise<void> => {})
const putMessages = vi.fn(
  async (_messages: Array<MessageRow>): Promise<void> => {}
)
const putSession = vi.fn(async (_session: SessionData): Promise<void> => {})
const putSessionAndMessages = vi.fn(
  async (_session: SessionData, _messages: Array<MessageRow>): Promise<void> => {}
)
const recordUsage = vi.fn(
  async (
    _usage: SessionData["usage"],
    _provider: SessionData["provider"],
    _model: SessionData["model"],
    _timestamp: number
  ): Promise<void> => {}
)

type MockAgentEvent =
  | {
      message: AssistantMessage
      type: "message_end"
    }
  | {
      type: "stream_update"
    }

type MockAgentState = {
  error: string | undefined
  isStreaming: boolean
  messages: Array<Message>
  model: {
    id: string
    provider: string
  }
  streamMessage: AgentMessage | null
  thinkingLevel: "medium"
}

type MockAgentClass = {
  abort: () => void
  prompt: (message: Message & { id: string }) => Promise<void>
  sessionId: string
  setModel: (model: { id: string; provider: string }) => void
  setThinkingLevel: (thinkingLevel: "medium" | "off" | "high") => void
  setTools: (tools: Array<AgentTool>) => void
  state: MockAgentState
  subscribe: (listener: (event: MockAgentEvent) => void) => () => void
}

type Subscriber = (event: MockAgentEvent) => void
let subscriber: Subscriber | undefined

const agentState: MockAgentState = {
  error: undefined as string | undefined,
  isStreaming: false,
  messages: [],
  model: {
    id: "gpt-5.1-codex-mini",
    provider: "openai-codex",
  },
  streamMessage: null,
  thinkingLevel: "medium" as const,
}

const promptMock = vi.fn(
  async (_message: Message & { id: string }): Promise<void> => {}
)
const abortMock = vi.fn(() => {})
const setModelMock = vi.fn(
  (_model: { id: string; provider: string }): void => {}
)
const setThinkingLevelMock = vi.fn(
  (_thinkingLevel: "medium" | "off" | "high"): void => {}
)
const setToolsMock = vi.fn((_tools: Array<AgentTool>): void => {})

vi.mock("@/db/schema", () => ({
  getSessionMessages,
  putMessage,
  putMessages,
  putSession,
  putSessionAndMessages,
  recordUsage,
}))

vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: class {
    state = agentState
    sessionId = ""

    constructor() {}

    subscribe(listener: Subscriber) {
      subscriber = listener
      return () => {
        subscriber = undefined
      }
    }

    prompt = promptMock
    abort = abortMock
    setModel = setModelMock
    setThinkingLevel = setThinkingLevelMock
    setTools = setToolsMock
  } satisfies new () => MockAgentClass,
}))

function createSession(): SessionData {
  return {
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
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  }
}

function createAssistantMessage(
  overrides: Partial<AssistantMessage> = {}
): AssistantMessage {
  return {
    api: "openai-responses",
    content: [{ text: "Done", type: "text" }],
    id: "assistant-1",
    model: "gpt-5.1-codex-mini",
    provider: "openai-codex",
    role: "assistant",
    stopReason: "stop",
    timestamp: 2,
    usage: createEmptyUsage(),
    ...overrides,
  }
}

function createToolResultMessage(
  overrides: Partial<ToolResultMessage> = {}
): ToolResultMessage {
  return {
    content: [{ text: "README contents", type: "text" }],
    id: "tool-result-1",
    isError: false,
    role: "toolResult",
    timestamp: 2,
    toolCallId: "call-1",
    toolName: "read",
    ...overrides,
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function getPersistedSystemRows(): Array<
  SystemMessage & Pick<MessageRow, "sessionId" | "status">
> {
  return putSessionAndMessages.mock.calls.flatMap(([_session, messages]) =>
    messages.filter(
      (
        message
      ): message is SystemMessage & Pick<MessageRow, "sessionId" | "status"> =>
        message.role === "system"
    )
  )
}

describe("AgentHost persistence", () => {
  beforeEach(() => {
    getSessionMessages.mockReset()
    getSessionMessages.mockResolvedValue([])
    putMessage.mockClear()
    putMessages.mockClear()
    putSession.mockClear()
    putSessionAndMessages.mockClear()
    recordUsage.mockClear()
    promptMock.mockClear()
    abortMock.mockClear()
    setModelMock.mockClear()
    setThinkingLevelMock.mockClear()
    setToolsMock.mockClear()

    agentState.error = undefined
    agentState.isStreaming = false
    agentState.messages = []
    agentState.streamMessage = null
    subscriber = undefined
  })

  it("persists optimistic user and streaming assistant rows before completion", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    promptMock.mockImplementation(async () => {
      const assistant = createAssistantMessage()
      agentState.isStreaming = false
      agentState.messages = [
        {
          content: "read the repo",
          role: "user",
          timestamp: 1,
        },
        assistant,
      ]
      subscriber?.({
        message: assistant,
        type: "message_end",
      })
      await flushMicrotasks()
    })

    await host.prompt("read the repo")

    expect(putSessionAndMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        isStreaming: true,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          sessionId: "session-1",
          status: "completed",
        }),
        expect.objectContaining({
          role: "assistant",
          sessionId: "session-1",
          status: "streaming",
        }),
      ])
    )

    host.dispose()
  })

  it("persists tool result rows while the stream is still active", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    promptMock.mockImplementation(async () => {
      const toolResult = createToolResultMessage()
      agentState.isStreaming = true
      agentState.messages = [
        {
          content: "read the repo",
          role: "user",
          timestamp: 1,
        },
        toolResult,
      ]
      agentState.streamMessage = createAssistantMessage({
        content: [
          {
            arguments: { path: "README.md" },
            id: "call-1",
            name: "read",
            type: "toolCall",
          },
        ],
        id: "assistant-stream",
        stopReason: "toolUse",
        timestamp: 3,
        usage: createEmptyUsage(),
      })

      subscriber?.({ type: "stream_update" })
      agentState.isStreaming = false
      agentState.streamMessage = null
      await flushMicrotasks()
    })

    await host.prompt("read the repo")

    expect(putMessages).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "tool-result-1",
          role: "toolResult",
          sessionId: "session-1",
          toolCallId: "call-1",
        }),
      ])
    )
    expect(putMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        sessionId: "session-1",
        status: "streaming",
      })
    )

    host.dispose()
  })

  it("persists the completed assistant row and clears isStreaming on normal completion", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])
    const assistant = createAssistantMessage({
      content: [{ text: "Finished", type: "text" }],
      id: "assistant-final",
    })

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = false
      agentState.messages = [
        {
          content: "hello",
          role: "user",
          timestamp: 1,
        },
        assistant,
      ]
      subscriber?.({
        message: assistant,
        type: "message_end",
      })
      await flushMicrotasks()
    })

    await host.prompt("hello")

    expect(putSessionAndMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        isStreaming: false,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          content: [{ text: "Finished", type: "text" }],
          role: "assistant",
          sessionId: "session-1",
          status: "completed",
        }),
      ])
    )

    host.dispose()
  })

  it("records usage only once when duplicate assistant completion events arrive", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])
    const assistant = createAssistantMessage({
      id: "assistant-final",
      usage: {
        ...createEmptyUsage(),
        cost: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0.1,
          output: 0.2,
          total: 0.3,
        },
      },
    })

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = false
      agentState.messages = [
        {
          content: "hello",
          role: "user",
          timestamp: 1,
        },
        assistant,
      ]
      subscriber?.({
        message: assistant,
        type: "message_end",
      })
      subscriber?.({
        message: assistant,
        type: "message_end",
      })
      await flushMicrotasks()
    })

    await host.prompt("hello")

    expect(recordUsage).toHaveBeenCalledTimes(1)

    host.dispose()
  })

  it("does not record usage for zero-cost assistant completions", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])
    const assistant = createAssistantMessage({
      id: "assistant-zero-cost",
    })

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = false
      agentState.messages = [
        {
          content: "hello",
          role: "user",
          timestamp: 1,
        },
        assistant,
      ]
      subscriber?.({
        message: assistant,
        type: "message_end",
      })
      await flushMicrotasks()
    })

    await host.prompt("hello")

    expect(recordUsage).not.toHaveBeenCalled()

    host.dispose()
  })

  it("does not re-record usage for a seeded persisted assistant message", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const seededAssistant: MessageRow = {
      ...createAssistantMessage({
        id: "seeded-assistant",
        usage: {
          ...createEmptyUsage(),
          cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0.1,
            output: 0.1,
            total: 0.2,
          },
        },
      }),
      sessionId: "session-1",
      status: "completed",
    }
    const host = new AgentHost(createSession(), [seededAssistant])

    subscriber?.({
      message: seededAssistant,
      type: "message_end",
    })
    await flushMicrotasks()

    expect(recordUsage).not.toHaveBeenCalled()

    host.dispose()
  })

  it("persists an errored assistant row and session error when prompt throws", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    promptMock.mockRejectedValue(new Error("Prompt failed"))

    await host.prompt("hello")

    expect(putSessionAndMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Prompt failed",
        isStreaming: false,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          sessionId: "session-1",
          status: "error",
        }),
      ])
    )

    expect(putSessionAndMessages).toHaveBeenCalledWith(
      expect.any(Object),
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          sessionId: "session-1",
        }),
      ])
    )

    host.dispose()
  })

  it("persists an aborted assistant row when the host is aborted mid-stream", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true
      agentState.streamMessage = createAssistantMessage({
        content: [{ text: "Partial", type: "text" }],
        id: "assistant-partial",
        stopReason: "toolUse",
      })
      host.abort()
      agentState.isStreaming = false
      agentState.streamMessage = null
      agentState.messages = [
        {
          content: "hello",
          role: "user",
          timestamp: 1,
        },
      ]
      subscriber?.({ type: "stream_update" })
      await flushMicrotasks()
    })

    await host.prompt("hello")

    expect(putSessionAndMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        isStreaming: false,
      }),
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          sessionId: "session-1",
          status: "aborted",
          stopReason: "aborted",
        }),
      ])
    )

    host.dispose()
  })

  it("dedupes repeated system notices for the same classified error", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])
    const error = new GitHubFsError("EACCES", "Authentication required", "/")

    promptMock.mockRejectedValue(error)

    await host.prompt("first")
    await host.prompt("second")

    expect(
      putSessionAndMessages.mock.calls.filter(([_session, messages]) =>
        messages.some(
          (message) =>
            message.role === "system" && message.kind === "github_auth"
        )
      )
    ).toHaveLength(1)

    host.dispose()
  })

  it("appends multiple system notices for distinct runtime failures", async () => {
    const { AgentHost } = await import("@/agent/agent-host")
    const host = new AgentHost(createSession(), [])

    promptMock
      .mockRejectedValueOnce(
        new GitHubFsError("EACCES", "Authentication required", "/")
      )
      .mockRejectedValueOnce(
        new GitHubFsError(
          "EACCES",
          "GitHub API rate limit exceeded (resets at 3:00:00 PM): /",
          "/"
        )
      )

    await host.prompt("first")
    await host.prompt("second")

    const systemKinds = getPersistedSystemRows().map((message) => message.kind)

    expect(systemKinds).toEqual(
      expect.arrayContaining(["github_auth", "github_rate_limit"])
    )

    host.dispose()
  })
})
