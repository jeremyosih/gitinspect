import { describe, expect, it } from "vitest"
import { getChatBootstrapPanelMode } from "@/sessions/chat-bootstrap-ui"

describe("getChatBootstrapPanelMode", () => {
  it("shows bootstrap spinner only while bootstrap and no messages yet", () => {
    expect(
      getChatBootstrapPanelMode({
        bootstrapStatus: "bootstrap",
        effectiveStreaming: false,
        hasAssistantMessage: false,
        messageCount: 0,
      })
    ).toBe("bootstrap_spinner")
  })

  it("shows streaming pending when bootstrap or streaming and user message but no assistant yet", () => {
    expect(
      getChatBootstrapPanelMode({
        bootstrapStatus: "bootstrap",
        effectiveStreaming: false,
        hasAssistantMessage: false,
        messageCount: 1,
      })
    ).toBe("streaming_pending")

    expect(
      getChatBootstrapPanelMode({
        bootstrapStatus: "ready",
        effectiveStreaming: true,
        hasAssistantMessage: false,
        messageCount: 1,
      })
    ).toBe("streaming_pending")
  })

  it("shows empty ready only when status ready and no messages", () => {
    expect(
      getChatBootstrapPanelMode({
        bootstrapStatus: "ready",
        effectiveStreaming: false,
        hasAssistantMessage: false,
        messageCount: 0,
      })
    ).toBe("empty_ready")
  })

  it("treats undefined bootstrapStatus as ready", () => {
    expect(
      getChatBootstrapPanelMode({
        bootstrapStatus: undefined,
        effectiveStreaming: false,
        hasAssistantMessage: false,
        messageCount: 0,
      })
    ).toBe("empty_ready")
  })

  it("shows empty_other for failed bootstrap with no messages", () => {
    expect(
      getChatBootstrapPanelMode({
        bootstrapStatus: "failed",
        effectiveStreaming: false,
        hasAssistantMessage: false,
        messageCount: 0,
      })
    ).toBe("empty_other")
  })

  it("shows messages when assistant exists", () => {
    expect(
      getChatBootstrapPanelMode({
        bootstrapStatus: "bootstrap",
        effectiveStreaming: true,
        hasAssistantMessage: true,
        messageCount: 2,
      })
    ).toBe("messages")
  })
})
