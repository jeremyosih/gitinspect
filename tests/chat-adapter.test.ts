import { describe, expect, it } from "vitest"
import {
  deriveAssistantView,
  getAssistantText,
  getAssistantThinking,
  getAssistantToolCalls,
  getUserText,
  isToolResultMessage,
} from "@/components/chat-adapter"
import { createEmptyUsage } from "@/types/models"
import type {
  AssistantMessage,
  ChatMessage,
  ToolResultMessage,
  UserMessage,
} from "@/types/chat"

function userMessage(overrides: Partial<UserMessage> = {}): UserMessage {
  return {
    content: "hello",
    id: "u1",
    role: "user",
    timestamp: 0,
    ...overrides,
  }
}

function assistantMessage(
  content: AssistantMessage["content"]
): AssistantMessage {
  return {
    api: "openai-responses",
    content,
    id: "a1",
    model: "m1",
    provider: "openai",
    role: "assistant",
    stopReason: "stop",
    timestamp: 0,
    usage: createEmptyUsage(),
  }
}

describe("chat-adapter", () => {
  it("getUserText reads string content", () => {
    expect(getUserText(userMessage({ content: "plain" }))).toBe("plain")
  })

  it("getUserText joins text parts", () => {
    expect(
      getUserText(
        userMessage({
          content: [
            { text: "a", type: "text" },
            { text: "b", type: "text" },
          ],
        })
      )
    ).toBe("a\nb")
  })

  it("getAssistantText filters text blocks", () => {
    const msg = assistantMessage([
      { text: "Hi ", type: "text" },
      { thinking: "t", type: "thinking" },
      { text: "there", type: "text" },
    ])
    expect(getAssistantText(msg)).toBe("Hi there")
  })

  it("getAssistantThinking joins thinking blocks", () => {
    const msg = assistantMessage([
      { thinking: "a", type: "thinking" },
      { text: "x", type: "text" },
      { thinking: "b", type: "thinking" },
    ])
    expect(getAssistantThinking(msg)).toBe("a\nb")
  })

  it("getAssistantToolCalls extracts tool calls", () => {
    const tc = {
      arguments: {},
      id: "t1",
      name: "bash",
      type: "toolCall" as const,
    }
    const msg = assistantMessage([{ text: "x", type: "text" }, tc])
    expect(getAssistantToolCalls(msg)).toEqual([tc])
  })

  it("deriveAssistantView uses single version and empty sources", () => {
    const msg = assistantMessage([
      { thinking: "plan", type: "thinking" },
      { text: "out", type: "text" },
    ])
    const v = deriveAssistantView(msg)
    expect(v.text).toBe("out")
    expect(v.reasoning).toBe("plan")
    expect(v.sources).toEqual([])
    expect(v.versions).toEqual(["out"])
  })

  it("isToolResultMessage narrows tool result", () => {
    const tr: ToolResultMessage = {
      content: [{ text: "ok", type: "text" }],
      details: undefined,
      id: "tr1",
      isError: false,
      role: "toolResult",
      timestamp: 0,
      toolCallId: "t1",
      toolName: "bash",
    }
    const m: ChatMessage = tr
    expect(isToolResultMessage(m)).toBe(true)
    if (isToolResultMessage(m)) {
      expect(m.toolName).toBe("bash")
    }
  })
})
