import { describe, expect, it } from "vitest";
import {
  buildForkPromptFromSharedSession,
  createPublicShareSnapshot,
} from "@gitinspect/runtime/lib/public-share";
import type { MessageRow, SessionData } from "@gitinspect/db";
import { createEmptyUsage } from "@gitinspect/runtime/types/models";

function buildSession(): SessionData {
  return {
    cost: 0,
    createdAt: "2026-04-16T12:00:00.000Z",
    id: "session-1",
    isStreaming: false,
    messageCount: 4,
    model: "gpt-5.1-codex-mini",
    preview: "How does sharing work?",
    provider: "openai",
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
    sourceUrl: "https://github.com/acme/demo/blob/main/README.md",
    thinkingLevel: "medium",
    title: "Sharing test",
    updatedAt: "2026-04-16T12:05:00.000Z",
    usage: createEmptyUsage(),
  };
}

function buildMessages(): MessageRow[] {
  return [
    {
      content: "How does sharing work?",
      id: "user-1",
      order: 0,
      role: "user",
      sessionId: "session-1",
      status: "completed",
      timestamp: 1,
    },
    {
      api: "openai-responses",
      content: [
        { text: "It publishes a read-only snapshot.", type: "text" },
        {
          arguments: { path: "README.md" },
          id: "call-read",
          name: "read",
          type: "toolCall",
        },
      ],
      id: "assistant-1",
      model: "gpt-5.1-codex-mini",
      order: 1,
      provider: "openai",
      role: "assistant",
      sessionId: "session-1",
      status: "completed",
      stopReason: "toolUse",
      timestamp: 2,
      usage: createEmptyUsage(),
    },
    {
      content: [{ text: "# gitinspect", type: "text" }],
      id: "tool-result-1",
      isError: false,
      order: 2,
      parentAssistantId: "assistant-1",
      role: "toolResult",
      sessionId: "session-1",
      status: "completed",
      timestamp: 3,
      toolCallId: "call-read",
      toolName: "read",
    },
    {
      action: "open-github-settings",
      fingerprint: "fp-1",
      id: "system-1",
      kind: "github_rate_limit",
      message: "Internal-only system notice",
      order: 3,
      role: "system",
      sessionId: "session-1",
      severity: "warning",
      source: "github",
      status: "completed",
      timestamp: 4,
    },
    {
      api: "openai-responses",
      content: [{ text: "Still streaming", type: "text" }],
      id: "assistant-2",
      model: "gpt-5.1-codex-mini",
      order: 4,
      provider: "openai",
      role: "assistant",
      sessionId: "session-1",
      status: "streaming",
      stopReason: "stop",
      timestamp: 5,
      usage: createEmptyUsage(),
    },
  ];
}

describe("public share snapshot", () => {
  it("filters system and streaming rows while keeping tool results", () => {
    const snapshot = createPublicShareSnapshot({
      messages: buildMessages(),
      publishedAt: "2026-04-16T12:06:00.000Z",
      session: buildSession(),
      updatedAt: "2026-04-16T12:06:00.000Z",
    });

    expect(snapshot.session).toMatchObject({
      id: "session-1",
      title: "Sharing test",
    });
    expect(snapshot.messages.map((message) => message.id)).toEqual([
      "user-1",
      "assistant-1",
      "tool-result-1",
    ]);
    expect(snapshot.session).not.toHaveProperty("ownerUserId");
    expect(snapshot.messages.every((message) => !("realmId" in message))).toBe(true);
  });

  it("builds a private fork prompt from the shared transcript", () => {
    const snapshot = createPublicShareSnapshot({
      messages: buildMessages(),
      publishedAt: "2026-04-16T12:06:00.000Z",
      session: buildSession(),
      updatedAt: "2026-04-16T12:06:00.000Z",
    });

    const prompt = buildForkPromptFromSharedSession({
      messages: snapshot.messages,
      prompt: "Continue with more details",
      repoSource: snapshot.session.repoSource,
      sourceUrl: snapshot.session.sourceUrl,
    });

    expect(prompt).toContain("Shared transcript:");
    expect(prompt).toContain("# Chat about acme/demo");
    expect(prompt).toContain("1. read — Completed");
    expect(prompt).toContain("New prompt: Continue with more details");
    expect(prompt).not.toContain("Internal-only system notice");
    expect(prompt).not.toContain("Still streaming");
  });
});
