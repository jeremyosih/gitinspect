import { getIsoNow } from "@gitinspect/shared/lib/dates";
import {
  derivePhaseFromStatus,
  deriveStatusFromPhase,
  normalizeSessionRuntime,
} from "./session-runtime-normalization";
import { deleteSessionRuntime, getSessionRuntime, putSessionRuntime } from "./sessions";
import type { SessionRuntimeRow } from "./types";

export { derivePhaseFromStatus, deriveStatusFromPhase, normalizeSessionRuntime };

export type SessionRuntimePatch = Partial<Omit<SessionRuntimeRow, "sessionId" | "updatedAt">>;

export async function patchSessionRuntime(
  sessionId: string,
  changes: SessionRuntimePatch,
): Promise<SessionRuntimeRow> {
  const now = getIsoNow();
  const current = normalizeSessionRuntime(sessionId, await getSessionRuntime(sessionId));
  const phase = changes.phase ?? current?.phase ?? derivePhaseFromStatus(changes.status);
  const next: SessionRuntimeRow = {
    assistantMessageId: changes.assistantMessageId ?? current?.assistantMessageId,
    lastError: Object.prototype.hasOwnProperty.call(changes, "lastError")
      ? changes.lastError
      : current?.lastError,
    lastProgressAt: changes.lastProgressAt ?? current?.lastProgressAt,
    lastTerminalStatus: Object.prototype.hasOwnProperty.call(changes, "lastTerminalStatus")
      ? changes.lastTerminalStatus
      : current?.lastTerminalStatus,
    ownerTabId: Object.prototype.hasOwnProperty.call(changes, "ownerTabId")
      ? changes.ownerTabId
      : current?.ownerTabId,
    pendingToolCallOwners: Object.prototype.hasOwnProperty.call(changes, "pendingToolCallOwners")
      ? changes.pendingToolCallOwners
      : current?.pendingToolCallOwners,
    phase,
    sessionId,
    startedAt: changes.startedAt ?? current?.startedAt,
    status:
      changes.status ??
      (phase ? deriveStatusFromPhase(phase, current) : (current?.status ?? "idle")),
    streamMessage: Object.prototype.hasOwnProperty.call(changes, "streamMessage")
      ? changes.streamMessage
      : current?.streamMessage,
    turnId: Object.prototype.hasOwnProperty.call(changes, "turnId")
      ? changes.turnId
      : current?.turnId,
    updatedAt: now,
  };

  await putSessionRuntime(next);
  return next;
}

export async function replaceSessionRuntime(row: SessionRuntimeRow): Promise<SessionRuntimeRow> {
  const normalized = normalizeSessionRuntime(row.sessionId, row);

  if (!normalized) {
    throw new Error(`Missing runtime row for ${row.sessionId}`);
  }

  await putSessionRuntime({
    ...normalized,
    updatedAt: getIsoNow(),
  });

  return normalized;
}

export async function markTurnStarted(params: {
  assistantMessageId: string;
  ownerTabId?: string;
  sessionId: string;
  turnId: string;
}): Promise<SessionRuntimeRow> {
  const now = getIsoNow();
  return await patchSessionRuntime(params.sessionId, {
    assistantMessageId: params.assistantMessageId,
    lastError: undefined,
    lastProgressAt: now,
    lastTerminalStatus: undefined,
    ownerTabId: params.ownerTabId,
    pendingToolCallOwners: {},
    phase: "running",
    startedAt: now,
    status: "streaming",
    streamMessage: undefined,
    turnId: params.turnId,
  });
}

export async function markTurnProgress(params: {
  assistantMessageId?: string;
  ownerTabId?: string;
  sessionId: string;
  turnId?: string;
}): Promise<SessionRuntimeRow> {
  return await patchSessionRuntime(params.sessionId, {
    assistantMessageId: params.assistantMessageId,
    lastProgressAt: getIsoNow(),
    ownerTabId: params.ownerTabId,
    phase: "running",
    status: "streaming",
    turnId: params.turnId,
  });
}

export async function markTurnCompleted(params: {
  assistantMessageId?: string;
  lastError?: string;
  ownerTabId?: string;
  sessionId: string;
  status: Extract<SessionRuntimeRow["status"], "aborted" | "completed" | "error">;
  turnId?: string;
}): Promise<SessionRuntimeRow> {
  return await patchSessionRuntime(params.sessionId, {
    assistantMessageId: params.assistantMessageId,
    lastError: params.lastError,
    lastProgressAt: getIsoNow(),
    lastTerminalStatus: params.status,
    ownerTabId: params.ownerTabId,
    pendingToolCallOwners: {},
    phase: params.status === "completed" ? "idle" : "interrupted",
    status: params.status,
    turnId: params.turnId,
  });
}

export async function markTurnInterrupted(params: {
  lastError: string;
  sessionId: string;
}): Promise<SessionRuntimeRow> {
  return await patchSessionRuntime(params.sessionId, {
    lastError: params.lastError,
    lastProgressAt: getIsoNow(),
    ownerTabId: undefined,
    pendingToolCallOwners: {},
    phase: "interrupted",
    status: "interrupted",
    turnId: undefined,
  });
}

export async function clearSessionRuntime(sessionId: string): Promise<void> {
  await deleteSessionRuntime(sessionId);
}
