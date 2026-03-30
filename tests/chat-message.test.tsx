import * as React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
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

  it("renders expandable HTML details for system messages", async () => {
    const { ChatMessage } = await import("@/components/chat-message")

    render(
      <ChatMessage
        followingMessages={[]}
        isStreamingReasoning={false}
        message={
          {
            detailsContext:
              "[fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo → https://api.fireworks.ai/inference/v1]",
            detailsHtml:
              "<!DOCTYPE html><html><head><title>Vercel Security Checkpoint</title></head><body><p>We're verifying your browser</p></body></html>",
            fingerprint: "provider_rate_limit:429 — Vercel Security Checkpoint",
            id: "system-1",
            kind: "provider_rate_limit",
            message: "429 — Vercel Security Checkpoint",
            role: "system",
            severity: "error",
            source: "provider",
            timestamp: 1,
          } satisfies ChatMessageType
        }
      />
    )

    expect(screen.getByText("429 — Vercel Security Checkpoint")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: /HTML response/i }))

    expect(
      screen.getByText(/Sandboxed preview for inspection only/i)
    ).toBeTruthy()
    expect(
      screen.getByText(
        /\[fireworks-ai\/accounts\/fireworks\/routers\/kimi-k2p5-turbo/
      )
    ).toBeTruthy()
    expect(
      screen.getByText(/<title>Vercel Security Checkpoint<\/title>/)
    ).toBeTruthy()
    expect(
      screen.getByTitle("HTML response preview system-1")
    ).toBeTruthy()
  })
})
