import { beforeEach, describe, expect, it } from "vitest";
import { TurnEventStore } from "@/agent/turn-event-store";
import { deleteAllLocalData, getSessionMessages, getSessionRuntime } from "@gitinspect/db";
import type { AssistantMessage, ToolResultMessage } from "@/types/chat";
import type { SessionData, SessionRuntimeRow } from "@/types/storage";
import { createEmptyUsage } from "@/types/models";

function createSession(id = "session-1"): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id,
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.4",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  };
}

function createTurn(turnId = "turn-1") {
  return {
    turnId,
    userMessage: {
      content: "hello",
      id: `user-${turnId}`,
      role: "user" as const,
      timestamp: 1,
    },
  };
}

function createAssistantMessage(params: {
  id: string;
  stopReason?: AssistantMessage["stopReason"];
  text?: string;
  timestamp: number;
  toolCallIds?: string[];
}): AssistantMessage {
  return {
    api: "openai-responses",
    content: [
      { text: params.text ?? params.id, type: "text" },
      ...(params.toolCallIds ?? []).map((toolCallId) => ({
        arguments: {},
        id: toolCallId,
        name: `tool-${toolCallId}`,
        type: "toolCall" as const,
      })),
    ],
    id: params.id,
    model: "gpt-5.4",
    provider: "openai-codex",
    role: "assistant",
    stopReason: params.stopReason ?? "stop",
    timestamp: params.timestamp,
    usage: createEmptyUsage(),
  };
}

function createToolResultMessage(params: {
  id: string;
  timestamp: number;
  toolCallId: string;
}): ToolResultMessage {
  return {
    content: [{ text: `result-${params.id}`, type: "text" }],
    id: params.id,
    isError: false,
    parentAssistantId: "",
    role: "toolResult",
    timestamp: params.timestamp,
    toolCallId: params.toolCallId,
    toolName: `tool-${params.toolCallId}`,
  };
}

describe("TurnEventStore", () => {
  beforeEach(async () => {
    await deleteAllLocalData();
  });

  it("beginTurn appends the user row immediately", async () => {
    const session = createSession();
    const store = new TurnEventStore({
      runtime: undefined,
      session,
      transcriptMessages: [],
    });

    await store.beginTurn({
      ownerTabId: "tab-1",
      turn: createTurn(),
    });

    expect(await getSessionMessages(session.id)).toEqual([
      expect.objectContaining({
        id: "user-turn-1",
        order: 0,
        role: "user",
      }),
    ]);
    expect(await getSessionRuntime(session.id)).toMatchObject({
      ownerTabId: "tab-1",
      phase: "running",
      status: "streaming",
      streamMessage: undefined,
      turnId: "turn-1",
    });
  });

  it("keeps assistant stream state in runtime until completion", async () => {
    const session = createSession();
    const store = new TurnEventStore({
      runtime: undefined,
      session,
      transcriptMessages: [],
    });

    await store.beginTurn({
      ownerTabId: "tab-1",
      turn: createTurn(),
    });

    const draft = createAssistantMessage({
      id: "assistant-stream",
      stopReason: "toolUse",
      text: "partial",
      timestamp: 2,
    });

    await store.applyEnvelope({
      kind: "assistant-stream",
      message: draft,
      sessionId: session.id,
      turnId: "turn-1",
    });

    expect(await getSessionMessages(session.id)).toEqual([
      expect.objectContaining({ id: "user-turn-1", role: "user" }),
    ]);
    expect(await getSessionRuntime(session.id)).toMatchObject({
      phase: "running",
      status: "streaming",
      streamMessage: expect.objectContaining({
        id: "assistant-stream",
        content: [{ text: "partial", type: "text" }],
      }),
    });

    const finalMessage = createAssistantMessage({
      id: "assistant-final",
      text: "done",
      timestamp: 3,
    });

    await store.applyEnvelope({
      kind: "message-end",
      message: finalMessage,
      sessionId: session.id,
      turnId: "turn-1",
    });

    expect(await getSessionMessages(session.id)).toEqual([
      expect.objectContaining({ id: "user-turn-1", order: 0, role: "user" }),
      expect.objectContaining({ id: "assistant-final", order: 1, role: "assistant" }),
    ]);
    expect(await getSessionRuntime(session.id)).toMatchObject({
      phase: "running",
      status: "streaming",
      streamMessage: undefined,
      turnId: "turn-1",
    });
  });

  it("links tool results and drops orphan rows", async () => {
    const session = createSession();
    const store = new TurnEventStore({
      runtime: undefined,
      session,
      transcriptMessages: [],
    });

    await store.beginTurn({
      ownerTabId: "tab-1",
      turn: createTurn(),
    });

    await store.applyEnvelope({
      kind: "message-end",
      message: createAssistantMessage({
        id: "assistant-1",
        timestamp: 2,
        toolCallIds: ["call-1"],
      }),
      sessionId: session.id,
      turnId: "turn-1",
    });

    await store.applyEnvelope({
      kind: "message-end",
      message: createToolResultMessage({
        id: "tool-result-1",
        timestamp: 3,
        toolCallId: "call-1",
      }),
      sessionId: session.id,
      turnId: "turn-1",
    });

    expect(await getSessionMessages(session.id)).toEqual([
      expect.objectContaining({ id: "user-turn-1", order: 0 }),
      expect.objectContaining({ id: "assistant-1", order: 1, role: "assistant" }),
      expect.objectContaining({
        id: "tool-result-1",
        order: 2,
        parentAssistantId: "assistant-1",
        role: "toolResult",
      }),
    ]);

    await store.applyEnvelope({
      kind: "message-end",
      message: createToolResultMessage({
        id: "tool-result-2",
        timestamp: 4,
        toolCallId: "missing-call",
      }),
      sessionId: session.id,
      turnId: "turn-1",
    });

    expect(await getSessionMessages(session.id)).toHaveLength(3);
    expect(await getSessionRuntime(session.id)).toMatchObject({
      lastError: "Dropped orphan tool result missing-call",
      pendingToolCallOwners: {},
    });
  });

  it("persists terminal completion and interruption states", async () => {
    const completedSession = createSession("session-completed");
    const completedStore = new TurnEventStore({
      runtime: undefined,
      session: completedSession,
      transcriptMessages: [],
    });

    await completedStore.beginTurn({
      ownerTabId: "tab-1",
      turn: createTurn("turn-completed"),
    });
    await completedStore.completeRun({ turnId: "turn-completed" });

    expect(await getSessionRuntime(completedSession.id)).toMatchObject({
      lastError: undefined,
      lastTerminalStatus: "completed",
      phase: "idle",
      status: "completed",
      streamMessage: undefined,
      turnId: "turn-completed",
    });

    const interruptedSession = createSession("session-interrupted");
    const interruptedStore = new TurnEventStore({
      runtime: undefined,
      session: interruptedSession,
      transcriptMessages: [],
    });

    await interruptedStore.beginTurn({
      ownerTabId: "tab-2",
      turn: createTurn("turn-interrupted"),
    });
    await interruptedStore.interruptRun({
      lastError: "boom",
      status: "interrupted",
      turnId: "turn-interrupted",
    });

    expect(await getSessionRuntime(interruptedSession.id)).toMatchObject({
      lastError: "boom",
      lastTerminalStatus: undefined,
      ownerTabId: undefined,
      phase: "interrupted",
      status: "interrupted",
      turnId: "turn-interrupted",
    });
  });

  it("clears an interrupted draft before a resumed turn starts", async () => {
    const session = createSession();
    const interruptedRuntime: SessionRuntimeRow = {
      lastError: "Stream interrupted. The runtime stopped before completion.",
      lastProgressAt: "2026-03-24T12:01:00.000Z",
      pendingToolCallOwners: {},
      phase: "interrupted",
      sessionId: session.id,
      status: "interrupted",
      streamMessage: createAssistantMessage({
        id: "assistant-interrupted",
        stopReason: "toolUse",
        text: "partial",
        timestamp: 2,
      }),
      turnId: "turn-old",
      updatedAt: "2026-03-24T12:01:00.000Z",
    };
    const store = new TurnEventStore({
      runtime: interruptedRuntime,
      session,
      transcriptMessages: [],
    });

    await store.beginTurn({
      ownerTabId: "tab-1",
      turn: createTurn("turn-resumed"),
    });

    expect(await getSessionRuntime(session.id)).toMatchObject({
      ownerTabId: "tab-1",
      phase: "running",
      status: "streaming",
      streamMessage: undefined,
      turnId: "turn-resumed",
    });
  });
});
