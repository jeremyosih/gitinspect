import { beforeEach, describe, expect, it } from "vitest";
import { loadSessionWithMessages } from "@/sessions/session-service";
import {
  db,
  deleteAllLocalData,
  getSessionMessages,
  getSessionRuntime,
  putSession,
} from "@/db/schema";
import type { MessageRow, SessionData } from "@/types/storage";
import { createEmptyUsage } from "@/types/models";

type LegacyMessageRow = Omit<MessageRow, "order"> & {
  order?: number;
};

function createSession(id = "session-1", isStreaming = false): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id,
    isStreaming,
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

function createUserRow(sessionId: string): MessageRow {
  return {
    content: "hello",
    id: "user-1",
    order: 7,
    role: "user",
    sessionId,
    status: "completed",
    timestamp: 1,
  };
}

function createLegacyStreamingAssistantRow(sessionId: string): LegacyMessageRow {
  return {
    api: "openai-responses",
    content: [{ text: "partial", type: "text" }],
    id: "assistant-stream",
    model: "gpt-5.4",
    order: 11,
    provider: "openai-codex",
    role: "assistant",
    sessionId,
    status: "streaming",
    stopReason: "toolUse",
    timestamp: 2,
    usage: createEmptyUsage(),
  };
}

describe("session-service legacy sanitize", () => {
  beforeEach(async () => {
    await deleteAllLocalData();
  });

  it("backfills order, removes transcript streaming rows, hydrates interrupted runtime, and writes back once when safe", async () => {
    const session = createSession();
    await putSession(session);
    await db
      .table<LegacyMessageRow, string>("messages")
      .bulkPut([createUserRow(session.id), createLegacyStreamingAssistantRow(session.id)]);

    const firstLoad = await loadSessionWithMessages(session.id);
    const persistedMessages = await getSessionMessages(session.id);
    const persistedRuntime = await getSessionRuntime(session.id);
    const firstRuntimeUpdatedAt = persistedRuntime?.updatedAt;

    expect(firstLoad?.messages).toEqual([
      expect.objectContaining({ id: "user-1", order: 0, role: "user" }),
    ]);
    expect(firstLoad?.runtime).toMatchObject({
      phase: "interrupted",
      status: "interrupted",
      streamMessage: expect.objectContaining({
        id: "assistant-stream",
        content: [{ text: "partial", type: "text" }],
      }),
    });
    expect(persistedMessages).toEqual([
      expect.objectContaining({ id: "user-1", order: 0, role: "user" }),
    ]);
    expect(persistedRuntime).toMatchObject({
      phase: "interrupted",
      status: "interrupted",
      streamMessage: expect.objectContaining({ id: "assistant-stream" }),
    });

    const secondLoad = await loadSessionWithMessages(session.id);
    const secondRuntime = await getSessionRuntime(session.id);

    expect(secondLoad?.messages).toEqual(firstLoad?.messages);
    expect(secondLoad?.runtime).toEqual(firstLoad?.runtime);
    expect(secondLoad?.session).toEqual(firstLoad?.session);
    expect(secondRuntime?.updatedAt).toBe(firstRuntimeUpdatedAt);
  });

  it("defers runtime hydration when the session is actively leased", async () => {
    const session = createSession("session-live", true);
    await putSession(session);
    await db
      .table<LegacyMessageRow, string>("messages")
      .bulkPut([createUserRow(session.id), createLegacyStreamingAssistantRow(session.id)]);
    const now = new Date().toISOString();
    await db.sessionLeases.put({
      acquiredAt: now,
      heartbeatAt: now,
      ownerTabId: "other-tab",
      ownerToken: "lease-1",
      sessionId: session.id,
    });

    const loaded = await loadSessionWithMessages(session.id);

    expect(loaded?.messages).toEqual([
      expect.objectContaining({ id: "user-1", order: 0, role: "user" }),
    ]);
    expect(loaded?.runtime).toBeUndefined();
    expect(loaded?.session.isStreaming).toBe(true);
    expect(await getSessionRuntime(session.id)).toBeUndefined();
    expect(await getSessionMessages(session.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "assistant-stream", status: "streaming" }),
      ]),
    );
  });
});
