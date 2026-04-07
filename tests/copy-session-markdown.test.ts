import { describe, expect, it, vi } from "vitest";
import { messagesToMarkdown } from "@/lib/copy-session-markdown";
import type { ChatMessage } from "@/types/chat";
import { createEmptyUsage } from "@/types/models";

function buildMessages(): ChatMessage[] {
  return [
    {
      content: "How does this repo work?",
      id: "user-1",
      role: "user",
      timestamp: 0,
    },
    {
      api: "openai-responses",
      content: [{ text: "It uses a repo-scoped runtime.", type: "text" }],
      id: "assistant-1",
      model: "gpt-5.1-codex-mini",
      provider: "openai",
      role: "assistant",
      stopReason: "stop",
      timestamp: 1,
      usage: createEmptyUsage(),
    },
  ];
}

function buildMessagesWithTools(): ChatMessage[] {
  return [
    {
      content: "How does copy work?",
      id: "user-1",
      role: "user",
      timestamp: 0,
    },
    {
      api: "openai-responses",
      content: [
        { text: "I inspected the export path.", type: "text" },
        {
          arguments: { limit: 18, offset: 626, path: "packages/ui/src/components/chat.tsx" },
          id: "call-read",
          name: "read",
          type: "toolCall",
        },
        {
          arguments: { command: 'rg -n "copySessionToClipboard|messagesToMarkdown" -S .' },
          id: "call-bash",
          name: "bash",
          type: "toolCall",
        },
        {
          arguments: { path: "packages/pi/src/lib/copy-session-markdown.ts" },
          id: "call-pending",
          name: "read",
          type: "toolCall",
        },
      ],
      id: "assistant-1",
      model: "gpt-5.1-codex-mini",
      provider: "openai",
      role: "assistant",
      stopReason: "toolUse",
      timestamp: 1,
      usage: createEmptyUsage(),
    },
    {
      content: [{ text: "file contents that should not be copied", type: "text" }],
      id: "tool-result-1",
      isError: false,
      parentAssistantId: "assistant-1",
      role: "toolResult",
      timestamp: 2,
      toolCallId: "call-read",
      toolName: "read",
      details: {
        path: "packages/ui/src/components/chat.tsx",
        resolvedPath: "/repo/packages/ui/src/components/chat.tsx",
      },
    },
    {
      content: [{ text: "command failed loudly", type: "text" }],
      id: "tool-result-2",
      isError: true,
      parentAssistantId: "assistant-1",
      role: "toolResult",
      timestamp: 3,
      toolCallId: "call-bash",
      toolName: "bash",
      details: {
        command: 'rg -n "copySessionToClipboard|messagesToMarkdown" -S .',
        cwd: "/repo",
        exitCode: 1,
      },
    },
  ];
}

describe("messagesToMarkdown", () => {
  it("prepends repo metadata and the original source URL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T14:31:00.000Z"));

    const markdown = messagesToMarkdown(buildMessages(), {
      repoSource: {
        owner: "acme",
        ref: "feature/foo",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          apiRef: "heads/feature/foo",
          fullRef: "refs/heads/feature/foo",
          kind: "branch",
          name: "feature/foo",
        },
      },
      sourceUrl: "https://github.com/acme/demo/blob/feature/foo/README.md",
    });

    expect(markdown).toContain("# Chat about acme/demo");
    expect(markdown).toContain("- Repository: `acme/demo`");
    expect(markdown).toContain("- Ref: `feature/foo`");
    expect(markdown).toContain("- Source: https://github.com/acme/demo/blob/feature/foo/README.md");
    expect(markdown).toContain("## User");
    expect(markdown).toContain("## Assistant");

    vi.useRealTimers();
  });

  it("falls back to a canonical GitHub URL when no source URL is stored", () => {
    const markdown = messagesToMarkdown(buildMessages(), {
      repoSource: {
        owner: "acme",
        ref: "0123456789abcdef0123456789abcdef01234567",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          kind: "commit",
          sha: "0123456789abcdef0123456789abcdef01234567",
        },
      },
    });

    expect(markdown).toContain(
      "- Source: https://github.com/acme/demo/commit/0123456789abcdef0123456789abcdef01234567",
    );
  });

  it("still exports plain chats without repo context", () => {
    const markdown = messagesToMarkdown(buildMessages());

    expect(markdown).toContain("# Chat");
    expect(markdown).not.toContain("- Repository:");
  });

  it("includes failed tool error messages without copying successful tool output", () => {
    const markdown = messagesToMarkdown(buildMessagesWithTools());

    expect(markdown).toContain("## Assistant\n\nI inspected the export path.");
    expect(markdown).toContain("### Tools");
    expect(markdown).toContain("1. read — Completed");
    expect(markdown).toContain("   path: packages/ui/src/components/chat.tsx");
    expect(markdown).toContain("   offset: 626");
    expect(markdown).toContain("   limit: 18");
    expect(markdown).toContain("   resolved: /repo/packages/ui/src/components/chat.tsx");
    expect(markdown).toContain("2. bash — Error");
    expect(markdown).toContain(
      '   command: rg -n "copySessionToClipboard|messagesToMarkdown" -S .',
    );
    expect(markdown).toContain("   cwd: /repo");
    expect(markdown).toContain("   error: command failed loudly");
    expect(markdown).toContain("3. read — Running");
    expect(markdown).toContain("   path: packages/pi/src/lib/copy-session-markdown.ts");
    expect(markdown).not.toContain("file contents that should not be copied");
  });
});
