import { beforeEach, describe, expect, it } from "vitest";
import {
  clearGuestChatAcknowledgement,
  clearPendingAuthAction,
  consumeReadyAuthAction,
  continueAsGuest,
  hasGuestChatAcknowledgement,
  openAuthDialog,
} from "../apps/web/src/store/auth-store";

describe("auth store", () => {
  beforeEach(async () => {
    sessionStorage.clear();
    clearPendingAuthAction();
    await clearGuestChatAcknowledgement();
  });

  it("does not release a pending first-message action until the user signs in", () => {
    openAuthDialog({
      postAuthAction: {
        content: "hello",
        route: "/chat",
        type: "send-first-message",
      },
      variant: "first-message",
    });

    expect(consumeReadyAuthAction({ isSignedIn: false, route: "/chat" })).toBeNull();
    expect(consumeReadyAuthAction({ isSignedIn: true, route: "/chat" })).toEqual({
      action: {
        content: "hello",
        route: "/chat",
        type: "send-first-message",
      },
      requiresConfirmation: false,
    });
    expect(consumeReadyAuthAction({ isSignedIn: true, route: "/chat" })).toBeNull();
  });

  it("releases the drafted first message after guest approval and persists the acknowledgement", async () => {
    openAuthDialog({
      postAuthAction: {
        content: "hello as guest",
        route: "/chat",
        type: "send-first-message",
      },
      variant: "first-message",
    });

    await continueAsGuest();

    expect(await hasGuestChatAcknowledgement()).toBe(true);
    expect(consumeReadyAuthAction({ isSignedIn: false, route: "/chat" })).toEqual({
      action: {
        content: "hello as guest",
        route: "/chat",
        type: "send-first-message",
      },
      requiresConfirmation: true,
    });
  });
});
