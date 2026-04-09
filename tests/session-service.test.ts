import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@gitinspect/db";
import { createEmptyUsage } from "@/types/models";
import type { SessionData } from "@/types/storage";

describe("session-service", () => {
  beforeEach(async () => {
    await db.messages.clear();
    await db.sessions.clear();
  });

  it("loads resolved repo sessions without runtime repair", async () => {
    const session: SessionData = {
      cost: 0,
      createdAt: "2026-03-24T12:00:00.000Z",
      error: undefined,
      id: "session-resolved",
      isStreaming: false,
      messageCount: 0,
      model: "gpt-5.1-codex-mini",
      preview: "",
      provider: "openai-codex",
      providerGroup: "openai-codex",
      repoSource: {
        owner: "acme",
        ref: "main",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          apiRef: "heads/main",
          fullRef: "refs/heads/main",
          kind: "branch",
          name: "main",
        },
      },
      thinkingLevel: "medium",
      title: "Resolved chat",
      updatedAt: "2026-03-24T12:00:00.000Z",
      usage: createEmptyUsage(),
    };

    await db.sessions.put(session);

    const { loadSession } = await import("@/sessions/session-service");
    const loadedSession = await loadSession("session-resolved");

    expect(loadedSession).toEqual(session);

    const persisted = await db.sessions.get("session-resolved");
    expect(persisted).toEqual(session);
  });
});
