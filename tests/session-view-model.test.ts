import { beforeEach, describe, expect, it } from "vitest";
import { loadSessionViewModel } from "@/sessions/session-view-model";
import { db, deleteAllLocalData, putSession, putSessionRuntime } from "@gitinspect/db";
import type { AssistantMessage } from "@/types/chat";
import type { MessageRow, SessionData, SessionRuntimeRow } from "@/types/storage";
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

function createAssistantDraft(params: {
  id: string;
  text: string;
  timestamp: number;
}): AssistantMessage {
  return {
    api: "openai-responses",
    content: [{ text: params.text, type: "text" }],
    id: params.id,
    model: "gpt-5.4",
    provider: "openai-codex",
    role: "assistant",
    stopReason: "toolUse",
    timestamp: params.timestamp,
    usage: createEmptyUsage(),
  };
}

function createMessageRow(message: MessageRow): MessageRow {
  return message;
}

async function seedSession(params: {
  messages: MessageRow[];
  runtime?: SessionRuntimeRow;
  session?: SessionData;
}): Promise<void> {
  const session = params.session ?? createSession();
  await putSession(session);

  if (params.messages.length > 0) {
    await db.messages.bulkPut(params.messages);
  }

  if (params.runtime) {
    await putSessionRuntime(params.runtime);
  }
}

describe("session-view-model", () => {
  beforeEach(async () => {
    await deleteAllLocalData();
  });

  it("projects transcript messages followed by the runtime draft", async () => {
    const session = createSession();
    await seedSession({
      messages: [
        createMessageRow({
          content: "hello",
          id: "user-1",
          order: 0,
          role: "user",
          sessionId: session.id,
          status: "completed",
          timestamp: 1,
        }),
        createMessageRow({
          api: "openai-responses",
          content: [{ text: "Finished reply", type: "text" }],
          id: "assistant-1",
          model: "gpt-5.4",
          order: 1,
          provider: "openai-codex",
          role: "assistant",
          sessionId: session.id,
          status: "completed",
          stopReason: "stop",
          timestamp: 2,
          usage: createEmptyUsage(),
        }),
      ],
      runtime: {
        lastProgressAt: "2026-03-24T12:01:00.000Z",
        pendingToolCallOwners: {},
        phase: "running",
        sessionId: session.id,
        status: "streaming",
        streamMessage: createAssistantDraft({
          id: "assistant-stream",
          text: "Still typing",
          timestamp: 3,
        }),
        turnId: "turn-1",
        updatedAt: "2026-03-24T12:01:00.000Z",
      },
      session: {
        ...session,
        isStreaming: true,
      },
    });

    const viewModel = await loadSessionViewModel(session.id);

    expect(viewModel?.displayMessages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
      "assistant-stream",
    ]);
    expect(viewModel?.isStreaming).toBe(true);
    expect(viewModel?.hasPartialAssistantText).toBe(true);
    expect(viewModel?.transcriptMessages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
    ]);
  });

  it("projects interrupted drafts with interrupted status", async () => {
    const session = createSession();
    await seedSession({
      messages: [],
      runtime: {
        lastError: "Stream interrupted. The runtime stopped before completion.",
        lastProgressAt: "2026-03-24T12:01:00.000Z",
        pendingToolCallOwners: {},
        phase: "interrupted",
        sessionId: session.id,
        status: "interrupted",
        streamMessage: createAssistantDraft({
          id: "assistant-interrupted",
          text: "Partial answer",
          timestamp: 2,
        }),
        updatedAt: "2026-03-24T12:01:00.000Z",
      },
      session,
    });

    const viewModel = await loadSessionViewModel(session.id);
    const runtimeMessage = viewModel?.displayMessages.at(-1);

    expect(runtimeMessage).toEqual(
      expect.objectContaining({
        id: "assistant-interrupted",
        status: "interrupted",
      }),
    );
    expect(viewModel?.isStreaming).toBe(false);
  });

  it("does not project a placeholder when runtime is not streaming or interrupted", async () => {
    const session = createSession();
    await seedSession({
      messages: [],
      runtime: {
        lastProgressAt: "2026-03-24T12:01:00.000Z",
        pendingToolCallOwners: {},
        phase: "idle",
        sessionId: session.id,
        status: "completed",
        streamMessage: createAssistantDraft({
          id: "assistant-stale",
          text: "Should not render",
          timestamp: 2,
        }),
        updatedAt: "2026-03-24T12:01:00.000Z",
      },
      session,
    });

    const viewModel = await loadSessionViewModel(session.id);

    expect(viewModel?.displayMessages).toEqual([]);
  });

  it("keeps the display list ready for copy and export by separating transcript history", async () => {
    const session = createSession();
    await seedSession({
      messages: [
        createMessageRow({
          content: "hello",
          id: "user-1",
          order: 0,
          role: "user",
          sessionId: session.id,
          status: "completed",
          timestamp: 1,
        }),
      ],
      runtime: {
        lastError: "Stream interrupted. The runtime stopped before completion.",
        lastProgressAt: "2026-03-24T12:01:00.000Z",
        pendingToolCallOwners: {},
        phase: "interrupted",
        sessionId: session.id,
        status: "interrupted",
        streamMessage: createAssistantDraft({
          id: "assistant-interrupted",
          text: "Partial answer",
          timestamp: 2,
        }),
        updatedAt: "2026-03-24T12:01:00.000Z",
      },
      session,
    });

    const viewModel = await loadSessionViewModel(session.id);

    expect(viewModel?.transcriptMessages.map((message) => message.id)).toEqual(["user-1"]);
    expect(viewModel?.displayMessages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-interrupted",
    ]);
  });
});
