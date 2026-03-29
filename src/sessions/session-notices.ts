import { createId } from "@/lib/ids"
import { getIsoNow } from "@/lib/dates"
import { buildSystemMessage, classifyRuntimeError } from "@/agent/runtime-errors"
import { pruneOrphanToolResults } from "@/agent/message-transformer"
import { toMessageRow } from "@/agent/session-adapter"
import { StreamInterruptedRuntimeError } from "@/agent/runtime-command-errors"
import { loadSessionLeaseState } from "@/db/session-leases"
import { markTurnInterrupted } from "@/db/session-runtime"
import {
  buildPersistedSession,
  loadSessionWithMessages,
} from "@/sessions/session-service"
import {
  deriveActiveSessionViewState,
  deriveRecoveryIntent,
  deriveRecoverySkipReason,
} from "@/sessions/session-view-state"
import {
  deleteSessionLease,
  getSessionRuntime,
  putSessionAndMessages,
  replaceSessionMessages,
} from "@/db/schema"
import type { MessageRow, SessionData } from "@/types/storage"

export type InterruptedRecoveryResult =
  | {
      kind: "noop"
      lastProgressAt?: string
      reason:
        | "local-runner"
        | "missing-session"
        | "not-streaming"
        | "remote-owned"
    }
  | { kind: "reconciled"; lastProgressAt?: string }

function isSystemFingerprintRow(
  message: MessageRow,
  fingerprint: string
): boolean {
  return message.role === "system" && message.fingerprint === fingerprint
}

function rewriteStreamingAssistantRows(
  messages: MessageRow[],
  errorMessage: string
): MessageRow[] {
  return messages.map((message) => {
    if (message.role !== "assistant" || message.status !== "streaming") {
      return message
    }

    return toMessageRow(
      message.sessionId,
      {
        ...message,
        errorMessage,
        stopReason: "error",
      },
      "error",
      message.id
    )
  })
}

function mergeSessionRows(
  session: SessionData,
  messages: MessageRow[]
): SessionData {
  return buildPersistedSession(
    {
      ...session,
      error: undefined,
      updatedAt: getIsoNow(),
    },
    messages
  )
}

export async function appendSessionNotice(
  sessionId: string,
  error: Error | string
): Promise<void> {
  const loaded = await loadSessionWithMessages(sessionId)

  if (!loaded) {
    return
  }

  const classified = classifyRuntimeError(error)

  if (
    loaded.messages.some((message) =>
      isSystemFingerprintRow(message, classified.fingerprint)
    )
  ) {
    return
  }

  const notice = toMessageRow(
    sessionId,
    buildSystemMessage(classified, createId(), Date.now())
  )

  await putSessionAndMessages(
    mergeSessionRows(loaded.session, [...loaded.messages, notice]),
    [notice]
  )
}

export async function reconcileInterruptedSession(
  sessionId: string,
  options: { hasLocalRunner?: boolean } = {}
): Promise<InterruptedRecoveryResult> {
  const [loaded, leaseState, runtime] = await Promise.all([
    loadSessionWithMessages(sessionId),
    loadSessionLeaseState(sessionId),
    getSessionRuntime(sessionId),
  ])
  const lastProgressAt = runtime?.lastProgressAt

  if (!loaded) {
    return { kind: "noop", lastProgressAt, reason: "missing-session" }
  }

  const state = deriveActiveSessionViewState({
    hasLocalRunner: options.hasLocalRunner === true,
    hasPartialAssistantText: false,
    lastProgressAt,
    leaseState,
    runtimeStatus: runtime?.status,
    sessionIsStreaming: loaded.session.isStreaming,
  })

  if (deriveRecoveryIntent(state) !== "run-now") {
    return {
      kind: "noop",
      lastProgressAt,
      reason: deriveRecoverySkipReason(state),
    }
  }

  const interruption = new StreamInterruptedRuntimeError()
  const classified = classifyRuntimeError(interruption)
  const rewrittenMessages = pruneOrphanToolResults(
    rewriteStreamingAssistantRows(loaded.messages, classified.message)
  )
  const hasNotice = rewrittenMessages.some((message) =>
    isSystemFingerprintRow(message, classified.fingerprint)
  )
  const nextMessages = hasNotice
    ? rewrittenMessages
    : [
        ...rewrittenMessages,
        toMessageRow(
          sessionId,
          buildSystemMessage(classified, createId(), Date.now())
        ),
      ]
  await replaceSessionMessages(
    buildPersistedSession(
      {
        ...loaded.session,
        error: undefined,
        isStreaming: false,
        updatedAt: getIsoNow(),
      },
      nextMessages
    ),
    nextMessages
  )

  await markTurnInterrupted({
    lastError: classified.message,
    sessionId,
  })

  if (leaseState.kind === "owned") {
    await deleteSessionLease(sessionId)
  }

  return { kind: "reconciled", lastProgressAt }
}
