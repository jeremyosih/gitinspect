import { describe, expect, it } from "vitest";
import { linkToolResults } from "@/agent/tool-result-linker";
import type { AssistantMessage, ToolResultMessage } from "@/types/chat";
import { createEmptyUsage } from "@/types/models";

function createAssistantMessage(params: {
  id: string;
  toolCallIds?: string[];
  timestamp: number;
}): AssistantMessage {
  return {
    api: "openai-responses",
    content: [
      { text: `assistant-${params.id}`, type: "text" },
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
    stopReason: "toolUse",
    timestamp: params.timestamp,
    usage: createEmptyUsage(),
  };
}

function createToolResultMessage(params: {
  id: string;
  parentAssistantId?: string;
  timestamp: number;
  toolCallId: string;
}): ToolResultMessage {
  return {
    content: [{ text: `result-${params.id}`, type: "text" }],
    id: params.id,
    isError: false,
    parentAssistantId: params.parentAssistantId ?? "wrong-parent",
    role: "toolResult",
    timestamp: params.timestamp,
    toolCallId: params.toolCallId,
    toolName: `tool-${params.toolCallId}`,
  };
}

describe("tool-result-linker", () => {
  it("rewrites an incorrect parentAssistantId", () => {
    const assistant = createAssistantMessage({
      id: "assistant-1",
      timestamp: 1,
      toolCallIds: ["call-1"],
    });
    const toolResult = createToolResultMessage({
      id: "tool-result-1",
      parentAssistantId: "assistant-wrong",
      timestamp: 2,
      toolCallId: "call-1",
    });

    const linked = linkToolResults([assistant, toolResult]);

    expect(linked.changed).toBe(true);
    expect(linked.messages).toEqual([
      assistant,
      expect.objectContaining({
        id: "tool-result-1",
        parentAssistantId: "assistant-1",
        toolCallId: "call-1",
      }),
    ]);
  });

  it("drops orphan tool results", () => {
    const assistant = createAssistantMessage({
      id: "assistant-1",
      timestamp: 1,
    });
    const orphan = createToolResultMessage({
      id: "tool-result-1",
      timestamp: 2,
      toolCallId: "missing-call",
    });

    const linked = linkToolResults([assistant, orphan]);

    expect(linked.changed).toBe(true);
    expect(linked.messages).toEqual([assistant]);
  });

  it("preserves multi-tool transcript ordering while linking results", () => {
    const assistant = createAssistantMessage({
      id: "assistant-1",
      timestamp: 1,
      toolCallIds: ["call-1", "call-2"],
    });
    const firstResult = createToolResultMessage({
      id: "tool-result-1",
      timestamp: 2,
      toolCallId: "call-1",
    });
    const secondResult = createToolResultMessage({
      id: "tool-result-2",
      timestamp: 3,
      toolCallId: "call-2",
    });

    const linked = linkToolResults([assistant, firstResult, secondResult]);

    expect(linked.changed).toBe(true);
    expect(linked.messages.map((message) => message.id)).toEqual([
      "assistant-1",
      "tool-result-1",
      "tool-result-2",
    ]);
    expect(linked.executionsByAssistantId.get("assistant-1")).toEqual([
      expect.objectContaining({
        toolCall: expect.objectContaining({ id: "call-1" }),
        toolResult: expect.objectContaining({ id: "tool-result-1" }),
      }),
      expect.objectContaining({
        toolCall: expect.objectContaining({ id: "call-2" }),
        toolResult: expect.objectContaining({ id: "tool-result-2" }),
      }),
    ]);
  });

  it("links repeated toolCall ids in transcript order", () => {
    const firstAssistant = createAssistantMessage({
      id: "assistant-1",
      timestamp: 1,
      toolCallIds: ["call-1"],
    });
    const firstResult = createToolResultMessage({
      id: "tool-result-1",
      timestamp: 2,
      toolCallId: "call-1",
    });
    const secondAssistant = createAssistantMessage({
      id: "assistant-2",
      timestamp: 3,
      toolCallIds: ["call-1"],
    });
    const secondResult = createToolResultMessage({
      id: "tool-result-2",
      timestamp: 4,
      toolCallId: "call-1",
    });

    const linked = linkToolResults([firstAssistant, firstResult, secondAssistant, secondResult]);

    expect(linked.messages).toEqual([
      firstAssistant,
      expect.objectContaining({ id: "tool-result-1", parentAssistantId: "assistant-1" }),
      secondAssistant,
      expect.objectContaining({ id: "tool-result-2", parentAssistantId: "assistant-2" }),
    ]);
  });
});
