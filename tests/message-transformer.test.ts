import { describe, expect, it } from "vitest"
import {
  toOpenAIResponsesInput,
  webMessageTransformer,
} from "@/agent/message-transformer"

describe("webMessageTransformer", () => {
  it("forwards only llm-compatible message roles with orphan tool results removed", () => {
    const transformed = webMessageTransformer([
      {
        content: "hello",
        role: "user",
        timestamp: 1,
      },
      {
        content: [{ text: "hi", type: "text" }],
        role: "toolResult",
        timestamp: 2,
        toolCallId: "call-1",
        toolName: "noop",
        isError: false,
      },
      {
        content: [{ text: "done", type: "text" }],
        role: "assistant",
        api: "openai-codex-responses",
        model: "gpt-5.1-codex-mini",
        provider: "openai-codex",
        stopReason: "stop",
        timestamp: 3,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
            total: 0,
          },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      },
      {
        label: "ui-only",
        role: "notice",
      } as never,
    ])

    expect(transformed.map((message) => message.role)).toEqual(["user", "assistant"])
  })

  it("serializes responses input using message and function items", () => {
    const input = toOpenAIResponsesInput([
      {
        content: "hello",
        role: "user",
        timestamp: 1,
      },
      {
        api: "openai-codex-responses",
        content: [
          { text: "I will inspect that file.", type: "text" },
          {
            arguments: { path: "README.md" },
            id: "call-1|fc-1",
            name: "read",
            type: "toolCall",
          },
        ],
        model: "gpt-5.1-codex-mini",
        provider: "openai-codex",
        role: "assistant",
        stopReason: "toolUse",
        timestamp: 2,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
            total: 0,
          },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      },
      {
        content: [{ text: "# gitinspect.com", type: "text" }],
        isError: false,
        role: "toolResult",
        timestamp: 3,
        toolCallId: "call-1|fc-1",
        toolName: "read",
      },
    ])

    expect(input).toEqual([
      {
        content: "hello",
        role: "user",
        type: "message",
      },
      {
        content: "I will inspect that file.",
        role: "assistant",
        type: "message",
      },
      {
        arguments: '{"path":"README.md"}',
        call_id: "call-1",
        id: "fc-1",
        name: "read",
        type: "function_call",
      },
      {
        call_id: "call-1",
        output: "# gitinspect.com",
        type: "function_call_output",
      },
    ])
  })

  it("drops orphan tool results from replay history", () => {
    const transformed = webMessageTransformer([
      {
        content: "hello",
        role: "user",
        timestamp: 1,
      },
      {
        content: [{ text: "README", type: "text" }],
        isError: false,
        role: "toolResult",
        timestamp: 2,
        toolCallId: "call-1",
        toolName: "read",
      },
      {
        api: "openai-codex-responses",
        content: [{ text: "done", type: "text" }],
        model: "gpt-5.1-codex-mini",
        provider: "openai-codex",
        role: "assistant",
        stopReason: "stop",
        timestamp: 3,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: {
            cacheRead: 0,
            cacheWrite: 0,
            input: 0,
            output: 0,
            total: 0,
          },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      },
    ])

    expect(transformed.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ])
  })

  it("never emits function outputs without a matching function call", () => {
    const input = toOpenAIResponsesInput([
      {
        content: "hello",
        role: "user",
        timestamp: 1,
      },
      {
        content: [{ text: "# gitinspect.com", type: "text" }],
        isError: false,
        role: "toolResult",
        timestamp: 2,
        toolCallId: "call-1|fc-1",
        toolName: "read",
      },
    ])

    expect(input).toEqual([
      {
        content: "hello",
        role: "user",
        type: "message",
      },
    ])
  })
})
