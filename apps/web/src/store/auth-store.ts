import * as React from "react";
import { deleteSetting, setSetting } from "@gitinspect/db";
import type {
  AuthDialogMode,
  AuthDialogReason,
  AuthDialogVariant,
  PendingAuthAction,
  ReadyAuthAction,
} from "@gitinspect/ui/components/github-auth-context";

const PENDING_AUTH_ACTION_KEY = "gitinspect.pending-auth-action";
const GUEST_ACKNOWLEDGED_SETTING_KEY = "auth.guest-chat-acknowledged";
const PENDING_AUTH_ACTION_TTL_MS = 1000 * 60 * 15;

type PendingAuthActionState = {
  action: PendingAuthAction;
  createdAt: number;
  status: "awaiting-auth" | "guest-approved";
};

type AuthStoreSnapshot = {
  dialogMode: AuthDialogMode;
  dialogOpen: boolean;
  dialogReason: AuthDialogReason;
  dialogVariant: AuthDialogVariant;
  pendingAction: PendingAuthActionState | null;
};

let snapshot: AuthStoreSnapshot = {
  dialogMode: "full",
  dialogOpen: false,
  dialogReason: "settings",
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

function isPendingAuthActionState(value: PendingAuthActionState): boolean {
  return (
    value.action.type === "send-first-message" &&
    typeof value.action.content === "string" &&
    typeof value.action.route === "string" &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    (value.status === "awaiting-auth" || value.status === "guest-approved")
  );
}

function isPendingActionExpired(value: PendingAuthActionState, now = Date.now()): boolean {
  return now - value.createdAt > PENDING_AUTH_ACTION_TTL_MS;
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

    if (isPendingAuthActionState(parsed) && !isPendingActionExpired(parsed)) {
      return parsed;
    }
  } catch {
    window.sessionStorage.removeItem(PENDING_AUTH_ACTION_KEY);
    return null;
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
  reason?: AuthDialogReason;
  variant?: AuthDialogVariant;
}): void {
  ensurePendingActionLoaded();

  updateSnapshot({
    dialogMode: input?.mode ?? "full",
    dialogOpen: true,
    dialogReason: input?.reason ?? "settings",
    dialogVariant: input?.variant ?? "default",
    pendingAction: input?.postAuthAction
      ? {
          action: input.postAuthAction,
          createdAt: Date.now(),
          status: "awaiting-auth",
        }
      : null,
  });
}

export function closeAuthDialog(): void {
  updateSnapshot({
    dialogMode: "full",
    dialogOpen: false,
    dialogReason: "settings",
    dialogVariant: "default",
  });
}

export async function continueAsGuest(): Promise<void> {
  ensurePendingActionLoaded();

  await setSetting(GUEST_ACKNOWLEDGED_SETTING_KEY, true);

  updateSnapshot({
    dialogMode: "full",
    dialogOpen: false,
    dialogReason: "settings",
    dialogVariant: "default",
    pendingAction: snapshot.pendingAction
      ? {
          ...snapshot.pendingAction,
          status: "guest-approved",
        }
      : null,
  });
}

export function consumeReadyAuthAction(input: {
  isSignedIn: boolean;
  route: string;
}): ReadyAuthAction | null {
  ensurePendingActionLoaded();

  const pendingAction = snapshot.pendingAction;

  if (!pendingAction) {
    return null;
  }

  if (isPendingActionExpired(pendingAction) || pendingAction.action.route !== input.route) {
    updateSnapshot({ pendingAction: null });
    return null;
  }

  const isReady = pendingAction.status === "guest-approved" || input.isSignedIn;

  if (!isReady) {
    return null;
  }

  updateSnapshot({ pendingAction: null });
  return {
    action: pendingAction.action,
    requiresConfirmation: pendingAction.status === "guest-approved",
  };
}

export function clearPendingAuthAction(): void {
  updateSnapshot({ pendingAction: null });
}

export async function hasGuestChatAcknowledgement(): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  const stored = await import("@gitinspect/db").then(({ getSetting }) =>
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
