import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatUsageNotice } from "@/components/chat-usage-notice";
import { renderWithProviders } from "@/test/render-with-providers";

describe("ChatUsageNotice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prompts signed-out users to sign in for free models", () => {
    renderWithProviders(
      <ChatUsageNotice
        isLoading={false}
        isVisible
        onSignIn={() => {}}
        onUpgrade={() => {}}
        session="signed-out"
      />,
    );

    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByText(/to access our free models with daily limits\./i)).toBeTruthy();
  });

  it("shows remaining daily messages for signed-in users", () => {
    renderWithProviders(
      <ChatUsageNotice
        balance={{
          breakdown: [{ reset: { interval: "day" } }],
          nextResetAt: Date.now() + 6 * 60 * 60 * 1000,
          remaining: 3,
        }}
        isLoading={false}
        isVisible
        onSignIn={() => {}}
        onUpgrade={() => {}}
        session="signed-in"
      />,
    );

    expect(screen.getByText("3 messages remaining today.")).toBeTruthy();
  });

  it("shows retry timing and upgrade action when messages are exhausted", () => {
    renderWithProviders(
      <ChatUsageNotice
        balance={{
          breakdown: [{ reset: { interval: "day" } }],
          nextResetAt: Date.now() + 6 * 60 * 60 * 1000,
          remaining: 0,
        }}
        isLoading={false}
        isVisible
        onSignIn={() => {}}
        onUpgrade={() => {}}
        session="signed-in"
      />,
    );

    expect(screen.getByText(/out of messages\./i)).toBeTruthy();
    expect(screen.getByText(/try again in 6 hours or/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "upgrade" })).toBeTruthy();
  });
});
