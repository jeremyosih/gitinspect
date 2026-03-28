import { fireEvent, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatComposer } from "@/components/chat-composer"
import { renderWithProviders } from "@/test/render-with-providers"

vi.mock("@/components/chat-model-selector", () => ({
  ChatModelSelector: () => <span data-testid="model-selector">Model</span>,
}))

describe("ChatComposer", () => {
  it("trims and sends text on submit", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)

    renderWithProviders(
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
    fireEvent.input(input, { target: { value: "  hello world  " } })

    fireEvent.submit(input.closest("form") as HTMLFormElement)

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("hello world")
    })
  })

  it("disables input and submit when composerDisabled", () => {
    const onSend = vi.fn()

    renderWithProviders(
      <ChatComposer
        composerDisabled
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
      "Select a repository to get started"
    ) as HTMLTextAreaElement
    expect(input.disabled).toBe(true)

    fireEvent.input(input, { target: { value: "hello" } })
    fireEvent.submit(input.closest("form") as HTMLFormElement)

    expect(onSend).not.toHaveBeenCalled()
  })

  it("does not send when empty", () => {
    const onSend = vi.fn()

    renderWithProviders(
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
    renderWithProviders(
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
    renderWithProviders(
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
