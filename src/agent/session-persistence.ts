import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { AssistantMessage as PiAssistantMessage } from "@mariozechner/pi-ai"
import type { AssistantMessage } from "@/types/chat"
import type { MessageRow, SessionData } from "@/types/storage"
import {
  getSessionMessages,
  putMessage,
  putMessages,
  putSession,
  putSessionAndMessages,
  recordUsage,
} from "@/db/schema"
import { getIsoNow } from "@/lib/dates"
import { buildPersistedSession } from "@/sessions/session-service"
import {
  inferMessageStatus,
  normalizeAssistantDraft,
  normalizeMessages,
  toMessageRow,
} from "@/agent/session-adapter"

export type TerminalAssistantStatus = "aborted" | "error" | undefined

type RuntimeStateSnapshot = {
  getCurrentAssistantId: () => string | undefined
  getError: () => string | undefined
  getLastDraftAssistant: () => AssistantMessage | undefined
  getLastTerminalStatus: () => TerminalAssistantStatus
  getMessages: () => Array<AgentMessage>
  getStreamMessage: () => AgentMessage | null
  isStreaming: () => boolean
  setLastDraftAssistant: (message: AssistantMessage | undefined) => void
}

function sortByTimestamp(left: MessageRow, right: MessageRow): number {
  return left.timestamp - right.timestamp
}

export class SessionPersistence {
  private readonly persistedMessageIds = new Set<string>()
  private readonly recordedAssistantMessageIds = new Set<string>()
  private persistQueue = Promise.resolve()

  constructor(
    private session: SessionData,
    private readonly runtimeState: RuntimeStateSnapshot,
    messages: Array<MessageRow>
  ) {
    this.seedRecordedCosts(messages)
  }

  getSession(): SessionData {
    return this.session
  }

  setSession(session: SessionData): void {
    this.session = session
  }

  async flush(): Promise<void> {
    await this.persistQueue
  }

  async recordAssistantUsage(
    message: PiAssistantMessage,
    messageId: string
  ): Promise<void> {
    if (
      message.usage.cost.total <= 0 ||
      this.recordedAssistantMessageIds.has(messageId)
    ) {
      return
    }

    this.recordedAssistantMessageIds.add(messageId)
    await recordUsage(
      message.usage,
      this.session.provider,
      this.session.model,
      message.timestamp
    )
  }

  buildCompletedRows(): Array<MessageRow> {
    const normalizedMessages = normalizeMessages(this.runtimeState.getMessages())
    let lastAssistantIndex = -1

    for (let index = normalizedMessages.length - 1; index >= 0; index -= 1) {
      if (normalizedMessages[index]?.role === "assistant") {
        lastAssistantIndex = index
        break
      }
    }

    return normalizedMessages.map((message, index) => {
      const currentAssistantId = this.runtimeState.getCurrentAssistantId()
      const id =
        message.role === "assistant" &&
        currentAssistantId &&
        index === lastAssistantIndex
          ? currentAssistantId
          : message.id

      return toMessageRow(
        this.session.id,
        message,
        inferMessageStatus(message),
        id
      )
    })
  }

  buildCurrentAssistantRow(): MessageRow | undefined {
    const draft = normalizeAssistantDraft(this.runtimeState.getStreamMessage())

    if (draft) {
      this.runtimeState.setLastDraftAssistant(draft)
    }

    const currentAssistantId = this.runtimeState.getCurrentAssistantId()
    const lastDraftAssistant = this.runtimeState.getLastDraftAssistant()

    if (!currentAssistantId || !lastDraftAssistant) {
      return undefined
    }

    if (this.runtimeState.isStreaming()) {
      return toMessageRow(
        this.session.id,
        {
          ...lastDraftAssistant,
          id: currentAssistantId,
          model: this.session.model,
          provider: this.session.provider,
        },
        "streaming",
        currentAssistantId
      )
    }

    const lastTerminalStatus = this.runtimeState.getLastTerminalStatus()

    if (!lastTerminalStatus) {
      return undefined
    }

    return toMessageRow(
      this.session.id,
      {
        ...lastDraftAssistant,
        errorMessage:
          lastTerminalStatus === "error"
            ? this.runtimeState.getError() ?? lastDraftAssistant.errorMessage
            : lastDraftAssistant.errorMessage,
        id: currentAssistantId,
        model: this.session.model,
        provider: this.session.provider,
        stopReason: lastTerminalStatus === "aborted" ? "aborted" : "error",
      },
      lastTerminalStatus,
      currentAssistantId
    )
  }

  buildCurrentRows(): Array<MessageRow> {
    const rowsById = new Map<string, MessageRow>()

    for (const row of this.buildCompletedRows()) {
      rowsById.set(row.id, row)
    }

    const currentAssistantRow = this.buildCurrentAssistantRow()

    if (currentAssistantRow) {
      rowsById.set(currentAssistantRow.id, currentAssistantRow)
    }

    return [...rowsById.values()].sort(sortByTimestamp)
  }

  async persistPromptStart(
    userRow: MessageRow,
    assistantRow: MessageRow
  ): Promise<void> {
    await this.persistSessionBoundary(
      {
        error: undefined,
        isStreaming: true,
      },
      [userRow, assistantRow],
      [...this.buildCompletedRows(), userRow, assistantRow]
    )
  }

  async persistStreamingProgress(
    currentAssistantRow: MessageRow | undefined,
    newlyCompletedRows: Array<MessageRow>
  ): Promise<void> {
    this.persistQueue = this.persistQueue.then(async () => {
      if (newlyCompletedRows.length > 0) {
        await putMessages(newlyCompletedRows)

        for (const message of newlyCompletedRows) {
          this.persistedMessageIds.add(message.id)
        }
      }

      if (currentAssistantRow) {
        await putMessage(currentAssistantRow)
        this.persistedMessageIds.add(currentAssistantRow.id)
      }
    })

    await this.persistQueue
  }

  async persistSessionBoundary(
    overrides: Pick<SessionData, "error" | "isStreaming">,
    changedMessages: Array<MessageRow>,
    rowsForDerivation?: Array<MessageRow>
  ): Promise<void> {
    const nextSessionBase = {
      ...this.session,
      error: overrides.error,
      isStreaming: overrides.isStreaming,
      updatedAt: getIsoNow(),
    }

    const allRows =
      rowsForDerivation ??
      (await getSessionMessages(this.session.id)).map((message) => {
        const changedMessage = changedMessages.find(
          (candidate) => candidate.id === message.id
        )
        return changedMessage ?? message
      })

    this.session = buildPersistedSession(nextSessionBase, allRows)

    this.persistQueue = this.persistQueue.then(async () => {
      if (changedMessages.length > 0) {
        await putSessionAndMessages(this.session, changedMessages)

        for (const message of changedMessages) {
          this.persistedMessageIds.add(message.id)
        }
        return
      }

      await putSession(this.session)
    })

    await this.persistQueue
  }

  async appendSystemRow(row: MessageRow): Promise<void> {
    this.persistQueue = this.persistQueue.then(async () => {
      const existing = await getSessionMessages(this.session.id)
      const merged = [...existing, row].sort(sortByTimestamp)
      this.session = buildPersistedSession(
        {
          ...this.session,
          updatedAt: getIsoNow(),
        },
        merged
      )
      await putSessionAndMessages(this.session, [row])
      this.persistedMessageIds.add(row.id)
    })

    await this.persistQueue
  }

  getNewlyCompletedRows(): Array<MessageRow> {
    return this.buildCompletedRows().filter(
      (message) => !this.persistedMessageIds.has(message.id)
    )
  }

  private seedRecordedCosts(messages: Array<MessageRow>): void {
    for (const message of messages) {
      this.persistedMessageIds.add(message.id)

      if (
        message.role !== "assistant" ||
        message.status !== "completed" ||
        message.usage.cost.total <= 0
      ) {
        continue
      }

      this.recordedAssistantMessageIds.add(message.id)
    }
  }
}
