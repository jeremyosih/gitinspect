import * as React from "react";
import { deleteSetting, setSetting } from "@gitinspect/db/schema";
import type {
  AuthDialogMode,
  AuthDialogVariant,
  PendingAuthAction,
} from "@gitinspect/ui/components/github-auth-context";

const PENDING_AUTH_ACTION_KEY = "gitinspect.pending-auth-action";
const GUEST_ACKNOWLEDGED_SETTING_KEY = "auth.guest-chat-acknowledged";

type PendingAuthActionState = {
  action: PendingAuthAction;
  status: "awaiting-auth" | "guest-approved";
};

type AuthStoreSnapshot = {
  dialogMode: AuthDialogMode;
  dialogOpen: boolean;
  dialogVariant: AuthDialogVariant;
  pendingAction: PendingAuthActionState | null;
};

let snapshot: AuthStoreSnapshot = {
  dialogMode: "full",
  dialogOpen: false,
  dialogVariant: "default",
  pendingAction: null,
};

const listeners = new Set<() => void>();
let hasLoadedPendingAction = false;

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function readStoredPendingAction(): PendingAuthActionState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(PENDING_AUTH_ACTION_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PendingAuthActionState;

    if (
      parsed &&
      parsed.action &&
      parsed.action.type === "send-first-message" &&
      typeof parsed.action.content === "string" &&
      typeof parsed.action.route === "string" &&
      (parsed.status === "awaiting-auth" || parsed.status === "guest-approved")
    ) {
      return parsed;
    }
  } catch {
    // Ignore malformed session storage state.
  }

  window.sessionStorage.removeItem(PENDING_AUTH_ACTION_KEY);
  return null;
}

function persistPendingAction(nextPendingAction: PendingAuthActionState | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!nextPendingAction) {
    window.sessionStorage.removeItem(PENDING_AUTH_ACTION_KEY);
    return;
  }

  window.sessionStorage.setItem(PENDING_AUTH_ACTION_KEY, JSON.stringify(nextPendingAction));
}

function ensurePendingActionLoaded(): void {
  if (hasLoadedPendingAction) {
    return;
  }

  hasLoadedPendingAction = true;
  snapshot = {
    ...snapshot,
    pendingAction: readStoredPendingAction(),
  };
}

function updateSnapshot(next: Partial<AuthStoreSnapshot>): void {
  ensurePendingActionLoaded();
  snapshot = {
    ...snapshot,
    ...next,
  };

  if (Object.prototype.hasOwnProperty.call(next, "pendingAction")) {
    persistPendingAction(next.pendingAction ?? null);
  }

  emitChange();
}

export function openAuthDialog(input?: {
  mode?: AuthDialogMode;
  postAuthAction?: PendingAuthAction;
  variant?: AuthDialogVariant;
}): void {
  ensurePendingActionLoaded();

  updateSnapshot({
    dialogMode: input?.mode ?? "full",
    dialogOpen: true,
    dialogVariant: input?.variant ?? "default",
    pendingAction: input?.postAuthAction
      ? {
          action: input.postAuthAction,
          status: "awaiting-auth",
        }
      : snapshot.pendingAction,
  });
}

export function closeAuthDialog(): void {
  updateSnapshot({ dialogMode: "full", dialogOpen: false, dialogVariant: "default" });
}

export async function continueAsGuest(): Promise<void> {
  ensurePendingActionLoaded();

  await setSetting(GUEST_ACKNOWLEDGED_SETTING_KEY, true);

  updateSnapshot({
    dialogMode: "full",
    dialogOpen: false,
    dialogVariant: "default",
    pendingAction: snapshot.pendingAction
      ? {
          ...snapshot.pendingAction,
          status: "guest-approved",
        }
      : null,
  });
}

export function consumeReadyAuthAction(isSignedIn: boolean): PendingAuthAction | null {
  ensurePendingActionLoaded();

  const pendingAction = snapshot.pendingAction;

  if (!pendingAction) {
    return null;
  }

  const isReady = pendingAction.status === "guest-approved" || isSignedIn;

  if (!isReady) {
    return null;
  }

  updateSnapshot({ pendingAction: null });
  return pendingAction.action;
}

export function clearPendingAuthAction(): void {
  updateSnapshot({ pendingAction: null });
}

export async function hasGuestChatAcknowledgement(): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  const stored = await import("@gitinspect/db/schema").then(({ getSetting }) =>
    getSetting(GUEST_ACKNOWLEDGED_SETTING_KEY),
  );
  return stored === true;
}

export async function clearGuestChatAcknowledgement(): Promise<void> {
  await deleteSetting(GUEST_ACKNOWLEDGED_SETTING_KEY);
}

export function useAuthStore(): AuthStoreSnapshot {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => {
      ensurePendingActionLoaded();
      return snapshot;
    },
    () => snapshot,
  );
}
