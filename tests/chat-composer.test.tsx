import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatComposer } from "@/components/chat-composer"

vi.mock("@/components/chat-model-selector", () => ({
  ChatModelSelector: () => <span data-testid="model-selector">Model</span>,
}))

describe("ChatComposer", () => {
  it("trims and sends text on submit", () => {
    const onSend = vi.fn().mockResolvedValue(undefined)

    render(
      <ChatComposer
        isStreaming={false}
        model="gpt-5.1-codex-mini"
        onAbort={() => {}}
        onSelectModel={() => {}}
        onSend={onSend}
        onThinkingLevelChange={() => {}}
        providerGroup="openai-codex"
        thinkingLevel="medium"
      />
    )

    const input = screen.getByPlaceholderText(
      "What would you like to know?"
    ) as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: "  hello world  " } })

    const submit = screen.getByRole("button", { name: /submit/i })
    fireEvent.click(submit)

    expect(onSend).toHaveBeenCalledWith("hello world")
  })

  it("does not send when empty", () => {
    const onSend = vi.fn()

    render(
      <ChatComposer
        isStreaming={false}
        model="gpt-5.1-codex-mini"
        onAbort={() => {}}
        onSelectModel={() => {}}
        onSend={onSend}
        onThinkingLevelChange={() => {}}
        providerGroup="openai-codex"
        thinkingLevel="medium"
      />
    )

    const submit = screen.getByRole("button", { name: /submit/i })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(submit)
    expect(onSend).not.toHaveBeenCalled()
  })

  it("disables submit while streaming", () => {
    render(
      <ChatComposer
        isStreaming
        model="gpt-5.1-codex-mini"
        onAbort={() => {}}
        onSelectModel={() => {}}
        onSend={vi.fn()}
        onThinkingLevelChange={() => {}}
        providerGroup="openai-codex"
        thinkingLevel="medium"
      />
    )

    const submit = screen.getByRole("button", { name: /stop/i })
    expect((submit as HTMLButtonElement).disabled).toBe(false)
  })

  it("renders model selector slot", () => {
    render(
      <ChatComposer
        isStreaming={false}
        model="gpt-5.1-codex-mini"
        onAbort={() => {}}
        onSelectModel={() => {}}
        onSend={vi.fn()}
        onThinkingLevelChange={() => {}}
        providerGroup="openai-codex"
        thinkingLevel="medium"
      />
    )

    expect(document.body.contains(screen.getByTestId("model-selector"))).toBe(
      true
    )
  })
})
