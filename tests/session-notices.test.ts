import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Message } from "@mariozechner/pi-ai"
import type { MessageRow, SessionData, SessionRuntimeRow } from "@/types/storage"
import { createEmptyUsage } from "@/types/models"
import {
  toOpenAIResponsesInput,
  webMessageTransformer,
} from "@/agent/message-transformer"
import {
  appendSessionNotice,
  reconcileInterruptedSession,
} from "@/sessions/session-notices"

const helpers = vi.hoisted(() => {
  const state = {
    messagesBySession: new Map<string, Array<MessageRow>>(),
    runtimeBySession: new Map<string, SessionRuntimeRow>(),
    sessions: new Map<string, SessionData>(),
  }

  function mergeSessionMessages(
    sessionId: string,
    messages: Array<MessageRow>
  ): void {
    const nextMessages = new Map<string, MessageRow>()

    for (const message of state.messagesBySession.get(sessionId) ?? []) {
      nextMessages.set(message.id, message)
    }

    for (const message of messages) {
      nextMessages.set(message.id, message)
    }

    state.messagesBySession.set(
      sessionId,
      [...nextMessages.values()].sort(
        (left, right) => left.timestamp - right.timestamp
      )
    )
  }

  const loadSessionWithMessages = vi.fn(
    async (
      sessionId: string
    ): Promise<
      { messages: Array<MessageRow>; session: SessionData } | undefined
    > => {
      const session = state.sessions.get(sessionId)

      if (!session) {
        return undefined
      }

      return {
        messages: state.messagesBySession.get(sessionId) ?? [],
        session,
      }
    }
  )

  const putSessionAndMessages = vi.fn(
    async (session: SessionData, messages: Array<MessageRow>): Promise<void> => {
      state.sessions.set(session.id, session)
      mergeSessionMessages(session.id, messages)
    }
  )

  const replaceSessionMessages = vi.fn(
    async (session: SessionData, messages: Array<MessageRow>): Promise<void> => {
      state.sessions.set(session.id, session)
      state.messagesBySession.set(
        session.id,
        [...messages].sort((left, right) => left.timestamp - right.timestamp)
      )
    }
  )

  const getSessionRuntime = vi.fn(
    async (sessionId: string): Promise<SessionRuntimeRow | undefined> =>
      state.runtimeBySession.get(sessionId)
  )

  const deleteSessionLease = vi.fn(async (_sessionId: string): Promise<void> => {})

  const loadSessionLeaseState = vi.fn(
    async () => ({ kind: "none" as const })
  )

  const markTurnInterrupted = vi.fn(
    async (params: {
      lastError: string
      sessionId: string
    }): Promise<SessionRuntimeRow> => {
      const next: SessionRuntimeRow = {
        lastError: params.lastError,
        sessionId: params.sessionId,
        status: "interrupted",
        updatedAt: "2026-03-24T12:00:00.000Z",
      }
      state.runtimeBySession.set(params.sessionId, next)
      return next
    }
  )

  return {
    deleteSessionLease,
    getSessionRuntime,
    loadSessionWithMessages,
    loadSessionLeaseState,
    markTurnInterrupted,
    putSessionAndMessages,
    replaceSessionMessages,
    state,
  }
})

vi.mock("@/sessions/session-service", () => ({
  buildPersistedSession: (
    session: SessionData,
    messages: Array<MessageRow>
  ) => ({
    ...session,
    messageCount: messages.length,
  }),
  loadSessionWithMessages: helpers.loadSessionWithMessages,
}))

vi.mock("@/db/schema", () => ({
  deleteSessionLease: helpers.deleteSessionLease,
  getSessionRuntime: helpers.getSessionRuntime,
  putSessionAndMessages: helpers.putSessionAndMessages,
  replaceSessionMessages: helpers.replaceSessionMessages,
}))

vi.mock("@/db/session-leases", () => ({
  loadSessionLeaseState: helpers.loadSessionLeaseState,
}))

vi.mock("@/db/session-runtime", () => ({
  markTurnInterrupted: helpers.markTurnInterrupted,
}))

function buildSession(overrides: Partial<SessionData> = {}): SessionData {
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
    repoSource: undefined,
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
    ...overrides,
  }
}

function buildStreamingAssistant(
  overrides: Partial<MessageRow> = {}
): MessageRow {
  return {
    api: "openai-responses",
    content: [{ text: "", type: "text" }],
    id: "assistant-1",
    model: "gpt-5.1-codex-mini",
    provider: "openai-codex",
    role: "assistant",
    sessionId: "session-1",
    status: "streaming",
    stopReason: "stop",
    timestamp: 2,
    usage: createEmptyUsage(),
    ...overrides,
  } as MessageRow
}

function buildUserMessage(): MessageRow {
  return {
    content: [{ text: "hello", type: "text" }],
    id: "user-1",
    role: "user",
    sessionId: "session-1",
    status: "completed",
    timestamp: 1,
  } as MessageRow
}

function buildToolResultMessage(
  overrides: Partial<MessageRow> = {}
): MessageRow {
  return {
    content: [{ text: "README contents", type: "text" }],
    id: "tool-result-1",
    isError: false,
    parentAssistantId: "assistant-1",
    role: "toolResult",
    sessionId: "session-1",
    status: "completed",
    timestamp: 3,
    toolCallId: "call-1",
    toolName: "read",
    ...overrides,
  } as MessageRow
}

describe("session-notices", () => {
  beforeEach(() => {
    helpers.state.messagesBySession.clear()
    helpers.state.runtimeBySession.clear()
    helpers.state.sessions.clear()
    helpers.deleteSessionLease.mockReset()
    helpers.getSessionRuntime.mockReset()
    helpers.loadSessionWithMessages.mockReset()
    helpers.loadSessionLeaseState.mockReset()
    helpers.markTurnInterrupted.mockReset()
    helpers.putSessionAndMessages.mockReset()
    helpers.replaceSessionMessages.mockReset()
    helpers.getSessionRuntime.mockImplementation(
      async (sessionId: string) => helpers.state.runtimeBySession.get(sessionId)
    )
    helpers.loadSessionLeaseState.mockImplementation(
      async () => ({ kind: "none" as const })
    )
    helpers.markTurnInterrupted.mockImplementation(async (params) => {
      const next: SessionRuntimeRow = {
        lastError: params.lastError,
        sessionId: params.sessionId,
        status: "interrupted",
        updatedAt: "2026-03-24T12:00:00.000Z",
      }
      helpers.state.runtimeBySession.set(params.sessionId, next)
      return next
    })
  })

  it("dedupes persisted notices", async () => {
    helpers.state.sessions.set(
      "session-1",
      buildSession({
        isStreaming: true,
      })
    )
    helpers.state.messagesBySession.set("session-1", [
      buildUserMessage(),
      buildStreamingAssistant(),
    ])

    await appendSessionNotice("session-1", new Error("boom"))
    await appendSessionNotice("session-1", new Error("boom"))

    expect(helpers.putSessionAndMessages).toHaveBeenCalledTimes(1)
    expect(
      helpers.state.messagesBySession
        .get("session-1")
        ?.filter((message) => message.role === "system")
    ).toHaveLength(1)
  })

  it("reconciles an interrupted session exactly once", async () => {
    helpers.state.sessions.set(
      "session-1",
      buildSession({
        isStreaming: true,
      })
    )
    helpers.state.messagesBySession.set("session-1", [
      buildUserMessage(),
      buildStreamingAssistant(),
    ])

    await reconcileInterruptedSession("session-1")
    await reconcileInterruptedSession("session-1")

    expect(helpers.replaceSessionMessages).toHaveBeenCalledTimes(1)
    expect(helpers.state.sessions.get("session-1")).toMatchObject({
      isStreaming: false,
    })
    expect(helpers.state.messagesBySession.get("session-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          status: "error",
        }),
        expect.objectContaining({
          fingerprint:
            "stream_interrupted:Stream interrupted. The runtime stopped before completion.",
          role: "system",
        }),
      ])
    )
  })

  it("updates the session when the notice already exists", async () => {
    helpers.state.sessions.set(
      "session-1",
      buildSession({
        isStreaming: true,
      })
    )
    helpers.state.messagesBySession.set("session-1", [
      buildUserMessage(),
      buildStreamingAssistant(),
      {
        fingerprint:
          "stream_interrupted:Stream interrupted. The runtime stopped before completion.",
        id: "system-1",
        kind: "stream_interrupted",
        message: "Stream interrupted. The runtime stopped before completion.",
        role: "system",
        sessionId: "session-1",
        severity: "error",
        source: "runtime",
        status: "completed",
        timestamp: 3,
      },
    ])

    await reconcileInterruptedSession("session-1")

    expect(helpers.replaceSessionMessages).toHaveBeenCalledTimes(1)
    expect(helpers.state.sessions.get("session-1")).toMatchObject({
      isStreaming: false,
    })
    expect(
      helpers.state.messagesBySession
        .get("session-1")
        ?.filter((message) => message.role === "system")
    ).toHaveLength(1)
    expect(helpers.state.messagesBySession.get("session-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "assistant-1",
          role: "assistant",
          status: "error",
        }),
      ])
    )
  })

  it("drops orphan tool results during interruption recovery", async () => {
    helpers.state.sessions.set(
      "session-1",
      buildSession({
        isStreaming: true,
      })
    )
    helpers.state.messagesBySession.set("session-1", [
      buildUserMessage(),
      buildStreamingAssistant({
        content: [{ text: "", type: "text" }],
      }),
      buildToolResultMessage(),
    ])

    await reconcileInterruptedSession("session-1")

    expect(
      helpers.state.messagesBySession
        .get("session-1")
        ?.some((message) => message.role === "toolResult")
    ).toBe(false)
  })

  it("keeps matching tool results during interruption recovery", async () => {
    helpers.state.sessions.set(
      "session-1",
      buildSession({
        isStreaming: true,
      })
    )
    helpers.state.messagesBySession.set("session-1", [
      buildUserMessage(),
      buildStreamingAssistant({
        content: [
          { text: "Reading...", type: "text" },
          {
            arguments: { path: "README.md" },
            id: "call-1",
            name: "read",
            type: "toolCall",
          },
        ],
      }),
      buildToolResultMessage(),
    ])

    await reconcileInterruptedSession("session-1")

    expect(
      helpers.state.messagesBySession.get("session-1")
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "toolResult",
          toolCallId: "call-1",
        }),
      ])
    )
  })

  it("repairs interrupted history so the next replay emits no orphan function outputs", async () => {
    helpers.state.sessions.set(
      "session-1",
      buildSession({
        isStreaming: true,
      })
    )
    helpers.state.messagesBySession.set("session-1", [
      buildUserMessage(),
      buildStreamingAssistant({
        content: [{ text: "", type: "text" }],
      }),
      buildToolResultMessage({
        toolCallId: "functions_bash_0|fc-1",
      }),
    ])

    await reconcileInterruptedSession("session-1")

    const replayMessages = (helpers.state.messagesBySession.get("session-1") ?? [])
      .filter((message) => message.role !== "system") as Message[]
    const replayInput = toOpenAIResponsesInput(webMessageTransformer(replayMessages))

    expect(
      replayInput.some((item) => item.type === "function_call_output")
    ).toBe(false)
  })
})
