import { deleteSessionLease } from "@gitinspect/db";
import { loadSessionLeaseState } from "@gitinspect/db/session-leases";
import {
  getRuntimeWorker,
  getRuntimeWorkerIfAvailable,
} from "@gitinspect/pi/agent/runtime-worker-client";
import { StreamInterruptedRuntimeError } from "@gitinspect/pi/agent/runtime-command-errors";
import { TurnEventStore } from "@gitinspect/pi/agent/turn-event-store";
import { loadSessionWithMessages } from "@gitinspect/pi/sessions/session-service";
import { loadSessionViewModel } from "@gitinspect/pi/sessions/session-view-model";
import {
  deriveActiveSessionViewState,
  deriveRecoveryIntent,
  deriveRecoverySkipReason,
} from "@gitinspect/pi/sessions/session-view-state";

export type InterruptedRecoveryResult =
  | {
      kind: "noop";
      lastProgressAt?: string;
      reason: "local-runner" | "missing-session" | "not-streaming" | "remote-owned";
    }
  | { kind: "reconciled"; lastProgressAt?: string };

async function appendSessionNoticeFallback(
  sessionId: string,
  error: Error | string,
): Promise<void> {
  const loaded = await loadSessionWithMessages(sessionId);

  if (!loaded) {
    return;
  }

  const store = new TurnEventStore({
    runtime: loaded.runtime,
    session: loaded.session,
    transcriptMessages: loaded.messages,
  });
  await store.applyEnvelope({
    error: error instanceof Error ? error : new Error(error),
    kind: "runtime-error",
    sessionId,
  });
}

async function reconcileInterruptedSessionFallback(sessionId: string): Promise<void> {
  const loaded = await loadSessionWithMessages(sessionId);

  if (!loaded || loaded.runtime?.phase !== "running") {
    return;
  }

  const interruption = new StreamInterruptedRuntimeError();
  const store = new TurnEventStore({
    runtime: loaded.runtime,
    session: loaded.session,
    transcriptMessages: loaded.messages,
  });
  await store.interruptRun({
    lastError: interruption.message,
    status: "interrupted",
    turnId: loaded.runtime.turnId,
  });
  await store.applyEnvelope({
    error: interruption,
    kind: "runtime-error",
    sessionId,
  });
}

export async function appendSessionNotice(sessionId: string, error: Error | string): Promise<void> {
  const worker = getRuntimeWorkerIfAvailable();

  if (!worker) {
    await appendSessionNoticeFallback(sessionId, error);
    return;
  }

  await getRuntimeWorker().appendSessionNotice({
    error: error instanceof Error ? error.message : error,
    sessionId,
  });
}

export async function reconcileInterruptedSession(
  sessionId: string,
  options: { hasLocalRunner?: boolean } = {},
): Promise<InterruptedRecoveryResult> {
  const [viewModel, leaseState] = await Promise.all([
    loadSessionViewModel(sessionId),
    loadSessionLeaseState(sessionId),
  ]);
  const lastProgressAt = viewModel?.runtime?.lastProgressAt;

  if (!viewModel) {
    return { kind: "noop", lastProgressAt, reason: "missing-session" };
  }

  const state = deriveActiveSessionViewState({
    hasLocalRunner: options.hasLocalRunner === true,
    hasPartialAssistantText: viewModel.hasPartialAssistantText,
    lastProgressAt,
    leaseState,
    runtimePhase: viewModel.runtime?.phase,
    runtimeStatus: viewModel.runtime?.status,
    sessionIsStreaming: viewModel.session.isStreaming,
  });

  if (deriveRecoveryIntent(state) !== "run-now") {
    return {
      kind: "noop",
      lastProgressAt,
      reason: deriveRecoverySkipReason(state),
    };
  }

  const worker = getRuntimeWorkerIfAvailable();

  if (worker) {
    await worker.reconcileInterruptedSession({ sessionId });
  } else {
    await reconcileInterruptedSessionFallback(sessionId);
  }

  if (leaseState.kind === "owned") {
    await deleteSessionLease(sessionId);
  }

  return { kind: "reconciled", lastProgressAt };
}
