import * as React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ChatMessage as ChatMessageType } from "@/types/chat"

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    search: _search,
    to: _to,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("a", props, children),
}))

function buildStreamingAssistant(): ChatMessageType & { status: "streaming" } {
  return {
    api: "openai-responses",
    content: [],
    id: "assistant-1",
    model: "gpt-5.1-codex-mini",
    provider: "openai-codex",
    role: "assistant",
    status: "streaming",
    stopReason: "stop",
    timestamp: 1,
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
  } as ChatMessageType & { status: "streaming" }
}

describe("ChatMessage", () => {
  it("shows a streaming placeholder before the assistant emits text", async () => {
    const { ChatMessage } = await import("@/components/chat-message")

    render(
      <ChatMessage
        followingMessages={[]}
        isStreamingReasoning={false}
        message={buildStreamingAssistant()}
      />
    )

    expect(screen.getByRole("status").textContent).toContain(
      "Assistant is streaming..."
    )
  })
})
