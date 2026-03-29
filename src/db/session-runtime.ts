import { getCurrentTabId } from "@/agent/tab-id"
import {
  deleteSessionRuntime,
  getSessionRuntime,
  putSessionRuntime,
} from "@/db/schema"
import { getIsoNow } from "@/lib/dates"
import type { SessionRuntimeRow, SessionRuntimeStatus } from "@/types/storage"

type SessionRuntimeUpdate = Partial<
  Omit<SessionRuntimeRow, "sessionId" | "updatedAt">
>

async function putRuntimeUpdate(
  sessionId: string,
  status: SessionRuntimeStatus,
  changes: SessionRuntimeUpdate = {}
): Promise<SessionRuntimeRow> {
  const now = getIsoNow()
  const current = await getSessionRuntime(sessionId)
  const next: SessionRuntimeRow = {
    assistantMessageId: current?.assistantMessageId,
    lastError: current?.lastError,
    lastProgressAt: current?.lastProgressAt,
    ownerTabId: current?.ownerTabId,
    sessionId,
    startedAt: current?.startedAt,
    status,
    turnId: current?.turnId,
    updatedAt: now,
    ...changes,
  }

  await putSessionRuntime(next)
  return next
}

export async function markTurnStarted(params: {
  assistantMessageId: string
  sessionId: string
  turnId: string
}): Promise<SessionRuntimeRow> {
  const now = getIsoNow()
  return await putRuntimeUpdate(params.sessionId, "streaming", {
    assistantMessageId: params.assistantMessageId,
    lastError: undefined,
    lastProgressAt: now,
    ownerTabId: getCurrentTabId(),
    startedAt: now,
    turnId: params.turnId,
  })
}

export async function markTurnProgress(params: {
  assistantMessageId?: string
  sessionId: string
  turnId?: string
}): Promise<SessionRuntimeRow> {
  return await putRuntimeUpdate(params.sessionId, "streaming", {
    assistantMessageId: params.assistantMessageId,
    lastProgressAt: getIsoNow(),
    ownerTabId: getCurrentTabId(),
    turnId: params.turnId,
  })
}

export async function markTurnCompleted(params: {
  assistantMessageId?: string
  sessionId: string
  status: Extract<SessionRuntimeStatus, "aborted" | "completed" | "error">
  turnId?: string
  lastError?: string
}): Promise<SessionRuntimeRow> {
  return await putRuntimeUpdate(params.sessionId, params.status, {
    assistantMessageId: params.assistantMessageId,
    lastError: params.lastError,
    lastProgressAt: getIsoNow(),
    ownerTabId: getCurrentTabId(),
    turnId: params.turnId,
  })
}

export async function markTurnInterrupted(params: {
  lastError: string
  sessionId: string
}): Promise<SessionRuntimeRow> {
  return await putRuntimeUpdate(params.sessionId, "interrupted", {
    lastError: params.lastError,
    ownerTabId: undefined,
  })
}

export async function clearSessionRuntime(sessionId: string): Promise<void> {
  await deleteSessionRuntime(sessionId)
}
