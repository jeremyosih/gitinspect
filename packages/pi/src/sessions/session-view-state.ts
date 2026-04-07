import type { SessionLeaseState } from "@gitinspect/db/session-leases";
import type { RuntimePhase, SessionRuntimeStatus } from "@gitinspect/db/storage-types";

export type ActiveSessionViewState =
  | { kind: "ready" }
  | { kind: "recovering"; lastProgressAt?: string }
  | { kind: "running-local"; lastProgressAt?: string }
  | {
      kind: "running-remote";
      freshness: "live" | "stale";
      lastProgressAt?: string;
    }
  | {
      kind: "interrupted";
      lastProgressAt?: string;
      resumeMode: "continue" | "retry";
    };

export type ActiveSessionViewInput = {
  hasLocalRunner: boolean;
  hasPartialAssistantText: boolean;
  lastProgressAt?: string;
  leaseState: SessionLeaseState;
  runtimePhase?: RuntimePhase;
  runtimeStatus?: SessionRuntimeStatus;
  sessionIsStreaming: boolean;
};

export type RecoveryIntent = "defer" | "none" | "run-now";

export type ResumeAction =
  | { label: "Continue response"; mode: "continue" }
  | { label: "Retry response"; mode: "retry" };

export type SessionBannerState =
  | { kind: "interrupted"; lastProgressAt?: string; resumeMode: "continue" | "retry" }
  | { kind: "remote-live"; lastProgressAt?: string }
  | { kind: "remote-stale"; lastProgressAt?: string };

export type ComposerState = {
  canAbort: boolean;
  canSend: boolean;
  disabled: boolean;
  disabledReason?: string;
  isStreaming: boolean;
};

export function deriveActiveSessionViewState(
  input: ActiveSessionViewInput,
): ActiveSessionViewState {
  const isRunning = input.runtimePhase === "running" || input.sessionIsStreaming;

  if (isRunning) {
    if (input.hasLocalRunner) {
      return {
        kind: "running-local",
        lastProgressAt: input.lastProgressAt,
      };
    }

    if (input.leaseState.kind === "locked") {
      return {
        freshness: "live",
        kind: "running-remote",
        lastProgressAt: input.lastProgressAt,
      };
    }

    if (input.leaseState.kind === "stale") {
      return {
        freshness: "stale",
        kind: "running-remote",
        lastProgressAt: input.lastProgressAt,
      };
    }

    return {
      kind: "recovering",
      lastProgressAt: input.lastProgressAt,
    };
  }

  if (input.runtimePhase === "interrupted" || input.runtimeStatus === "interrupted") {
    return {
      kind: "interrupted",
      lastProgressAt: input.lastProgressAt,
      resumeMode: input.hasPartialAssistantText ? "continue" : "retry",
    };
  }

  return { kind: "ready" };
}

export function deriveRecoveryIntent(state: ActiveSessionViewState): RecoveryIntent {
  if (state.kind === "recovering") {
    return "run-now";
  }

  if (state.kind === "running-remote") {
    return "defer";
  }

  return "none";
}

export function deriveRecoverySkipReason(
  state: ActiveSessionViewState,
): "local-runner" | "not-streaming" | "remote-owned" {
  if (state.kind === "running-local") {
    return "local-runner";
  }

  if (state.kind === "running-remote") {
    return "remote-owned";
  }

  return "not-streaming";
}

export function deriveResumeAction(state: ActiveSessionViewState): ResumeAction | undefined {
  if (state.kind !== "interrupted") {
    return undefined;
  }

  if (state.resumeMode === "continue") {
    return { label: "Continue response", mode: "continue" };
  }

  return { label: "Retry response", mode: "retry" };
}

export function deriveBannerState(state: ActiveSessionViewState): SessionBannerState | undefined {
  if (state.kind === "interrupted") {
    return {
      kind: "interrupted",
      lastProgressAt: state.lastProgressAt,
      resumeMode: state.resumeMode,
    };
  }

  if (state.kind === "running-remote") {
    return {
      kind: state.freshness === "stale" ? "remote-stale" : "remote-live",
      lastProgressAt: state.lastProgressAt,
    };
  }

  return undefined;
}

export function deriveComposerState(state: ActiveSessionViewState): ComposerState {
  if (state.kind === "running-local") {
    return {
      canAbort: true,
      canSend: false,
      disabled: false,
      isStreaming: true,
    };
  }

  if (state.kind === "running-remote") {
    return {
      canAbort: false,
      canSend: false,
      disabled: true,
      disabledReason:
        state.freshness === "stale"
          ? "Another tab still owns this streaming session"
          : "This session is active in another tab",
      isStreaming: false,
    };
  }

  if (state.kind === "recovering") {
    return {
      canAbort: false,
      canSend: false,
      disabled: true,
      disabledReason: "Waiting for this session to recover locally",
      isStreaming: false,
    };
  }

  return {
    canAbort: false,
    canSend: true,
    disabled: false,
    isStreaming: false,
  };
}

export function shouldDisplayConversationStreaming(state: ActiveSessionViewState): boolean {
  return state.kind === "running-local" || state.kind === "running-remote";
}
