import { Agent } from "@mariozechner/pi-agent-core"
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
} from "@mariozechner/pi-agent-core"
import type { AssistantMessage as PiAssistantMessage, Message } from "@mariozechner/pi-ai"
import type { AssistantMessage } from "@/types/chat"
import {
  createEmptyUsage,
  type ProviderGroupId,
  type ProviderId,
  type ThinkingLevel,
} from "@/types/models"
import type { MessageRow, RepoSource, SessionData } from "@/types/storage"
import {
  getSessionMessages,
  putMessage,
  putMessages,
  putSession,
  putSessionAndMessages,
  replaceSessionMessages,
  recordUsage,
} from "@/db/schema"
import { BusyRuntimeError } from "@/agent/runtime-command-errors"
import {
  pruneOrphanToolResults,
  webMessageTransformer,
} from "@/agent/message-transformer"
import { streamChatWithPiAgent } from "@/agent/provider-stream"
import {
  buildInitialAgentState,
  inferMessageStatus,
  normalizeAssistantDraft,
  normalizeMessages,
  toMessageRow,
} from "@/agent/session-adapter"
import { resolveApiKeyForProvider } from "@/auth/resolve-api-key"
import { getIsoNow } from "@/lib/dates"
import { createId } from "@/lib/ids"
import { getCanonicalProvider, getModel } from "@/models/catalog"
import { createRepoRuntime } from "@/repo/repo-runtime"
import { normalizeRepoSource } from "@/repo/settings"
import { appendSessionNotice } from "@/sessions/session-notices"
import { buildPersistedSession } from "@/sessions/session-service"
import {
  markTurnCompleted,
  markTurnProgress,
  markTurnStarted,
} from "@/db/session-runtime"
import { createRepoTools } from "@/tools"

type TerminalAssistantStatus = "aborted" | "error" | undefined
type AgentStateSnapshot = {
  error: string | undefined
  isStreaming: boolean
  messages: AgentMessage[]
  streamMessage: AgentMessage | null
}

const TURN_IDLE_TIMEOUT_MS = 15 * 60_000
const TURN_IDLE_POLL_MS = 30_000

function sortByTimestamp(left: MessageRow, right: MessageRow): number {
  return left.timestamp - right.timestamp
}

function toError(error: Error | string): Error {
  return error instanceof Error ? error : new Error(error)
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function rewriteStreamingAssistantRow(
  sessionId: string,
  message: MessageRow,
  errorMessage: string
): MessageRow {
  if (message.role !== "assistant" || message.status !== "streaming") {
    return message
  }

  return toMessageRow(
    sessionId,
    {
      ...message,
      errorMessage,
      stopReason: "error",
    },
    "error",
    message.id
  )
}

export class AgentHost {
  readonly agent: Agent

  private assignedAssistantIds = new Map<string, string>()
  private persistedMessageIds = new Set<string>()
  private recordedAssistantMessageIds = new Set<string>()
  private currentAssistantMessageId?: string
  private currentTurnId?: string
  private lastDraftAssistant?: AssistantMessage
  private lastTerminalStatus: TerminalAssistantStatus = undefined
  private disposed = false
  private promptPending = false
  private runningTurn?: Promise<void>
  private persistQueue = Promise.resolve()
  private eventQueue = Promise.resolve()
  private githubRuntimeTokenSnapshot?: string
  private getGithubToken?: () => Promise<string | undefined>
  private repoRuntime
  private sessionData: SessionData
  private unsubscribe?: () => void
  private lastProgressAt = 0
  private watchdogError?: Error
  private watchdogInterval?: ReturnType<typeof setInterval>
  private recoveringFromHandlerError = false

  constructor(
    session: SessionData,
    messages: Array<MessageRow>,
    options?: {
      getGithubToken?: () => Promise<string | undefined>
      githubRuntimeToken?: string
    }
  ) {
    this.sessionData = session
    this.githubRuntimeTokenSnapshot = options?.githubRuntimeToken
    this.getGithubToken = options?.getGithubToken
    this.repoRuntime = this.createRuntime(session.repoSource)
    this.seedAssignedAssistantIds(messages)
    this.seedRecordedCosts(messages)

    const model = getModel(this.session.provider, this.session.model)

    this.agent = new Agent({
      convertToLlm: webMessageTransformer,
      getApiKey: async (provider) =>
        await resolveApiKeyForProvider(
          provider as ProviderId,
          this.session.providerGroup
        ),
      initialState: buildInitialAgentState(
        this.session,
        messages,
        model,
        this.getAgentTools(this.repoRuntime)
      ),
      streamFn: streamChatWithPiAgent,
      toolExecution: "sequential",
    })
    this.agent.sessionId = this.session.id
    this.unsubscribe = this.agent.subscribe((event) => {
      this.enqueueEvent(event)
    })
  }

  private get session(): SessionData {
    return this.sessionData
  }

  private set session(session: SessionData) {
    this.sessionData = session
  }

  isBusy(): boolean {
    return this.promptPending || this.runningTurn !== undefined || this.agent.state.isStreaming
  }

  async startTurn(content: string): Promise<void> {
    const trimmed = content.trim()

    if (!trimmed || this.disposed) {
      return
    }

    if (this.isBusy()) {
      throw new BusyRuntimeError(this.session.id)
    }

    const timestamp = Date.now()
    this.currentTurnId = createId()
    const userMessage: Message & { id: string } = {
      content: trimmed,
      id: createId(),
      role: "user",
      timestamp,
    }

    this.currentAssistantMessageId = createId()
    this.lastDraftAssistant = {
      api: "openai-responses",
      content: [{ text: "", type: "text" }],
      id: this.currentAssistantMessageId,
      model: this.session.model,
      provider: this.session.provider,
      role: "assistant",
      stopReason: "stop",
      timestamp,
      usage: createEmptyUsage(),
    }
    this.lastTerminalStatus = undefined
    this.watchdogError = undefined
    this.promptPending = true

    const userRow = toMessageRow(this.session.id, userMessage)
    const assistantRow = toMessageRow(
      this.session.id,
      this.lastDraftAssistant,
      "streaming",
      this.currentAssistantMessageId
    )

    try {
      await this.persistPromptStart(userRow, assistantRow)
    } catch (error) {
      this.promptPending = false
      this.clearActiveStreamPointers()
      throw error
    }

    await markTurnStarted({
      assistantMessageId: assistantRow.id,
      sessionId: this.session.id,
      turnId: this.currentTurnId,
    })
    this.markProgress()

    this.runningTurn = this.runTurnToCompletion(userMessage).finally(() => {
      this.runningTurn = undefined
    })
  }

  async prompt(content: string): Promise<void> {
    await this.startTurn(content)
    await this.runningTurn
    await this.flushPersistence()
  }

  async flushPersistence(): Promise<void> {
    await this.persistQueue
  }

  async waitForTurn(): Promise<void> {
    await this.runningTurn
    await this.flushPersistence()
  }

  abort(): void {
    this.lastTerminalStatus = "aborted"
    this.agent.abort()
  }

  async setModelSelection(
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void> {
    if (this.disposed) {
      return
    }

    const provider = getCanonicalProvider(providerGroup)
    const model = getModel(provider, modelId)

    this.agent.setModel(model)
    this.agent.sessionId = this.session.id
    this.session = {
      ...this.session,
      error: undefined,
      model: modelId,
      provider,
      providerGroup,
      updatedAt: getIsoNow(),
    }
    await putSession(this.session)
  }

  async setThinkingLevel(thinkingLevel: ThinkingLevel): Promise<void> {
    if (this.disposed) {
      return
    }

    this.agent.setThinkingLevel(thinkingLevel)
    this.session = {
      ...this.session,
      thinkingLevel,
      updatedAt: getIsoNow(),
    }
    await putSession(this.session)
  }

  async refreshGithubToken(): Promise<void> {
    if (this.disposed) {
      return
    }

    const token = await this.getGithubToken?.()
    this.githubRuntimeTokenSnapshot = token
    this.repoRuntime = this.createRuntime(this.session.repoSource, token)
    this.agent.setTools(this.getAgentTools(this.repoRuntime))
  }

  dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.stopWatchdog()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.agent.abort()
  }

  private async runTurnToCompletion(
    userMessage: Message & { id: string }
  ): Promise<void> {
    this.startWatchdog()
    let promptError: Error | undefined

    try {
      await this.agent.prompt(userMessage)
    } catch (error) {
      if (this.isDisposed()) {
        return
      }

      promptError = error instanceof Error ? error : new Error(String(error))
      this.watchdogError ??= promptError
    } finally {
      this.promptPending = false
      this.stopWatchdog()
      await this.flushEventQueue()
      await this.flushPersistence()

      if (!this.isDisposed() && this.session.isStreaming) {
        const finalized = await this.persistCurrentTurnBoundary()

        if (!finalized) {
          await this.repairTurnFailure(
            this.watchdogError ??
              promptError ??
              new Error("Runtime stopped before clearing the streaming state.")
          )
        }
      }

      this.watchdogError = undefined
    }
  }

  private async handleEvent(
    event: AgentEvent,
    snapshot: AgentStateSnapshot
  ): Promise<void> {
    if (this.disposed) {
      return
    }
    this.markProgress()

    if (!snapshot.isStreaming && snapshot.error) {
      this.lastTerminalStatus ??= "error"
      await this.appendSystemNoticeFromError(new Error(snapshot.error))
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
      const recordedId = this.resolveAssistantRowId(event.message)

      if (recordedId) {
        await this.recordAssistantUsage(event.message, recordedId)
      }
    }

    if (snapshot.isStreaming) {
      const currentAssistantRow = this.buildCurrentAssistantRow(snapshot)
      const newlyCompletedRows = this.getNewlyCompletedRows(snapshot)

      if (currentAssistantRow || newlyCompletedRows.length > 0) {
        await this.persistStreamingProgress(currentAssistantRow, newlyCompletedRows)
      }

      if (event.type === "turn_end" && event.toolResults.length > 0) {
        this.currentAssistantMessageId = createId()
        this.lastDraftAssistant = undefined
      }

      return
    }

    const finalized = await this.persistCurrentTurnBoundary(snapshot)

    if (finalized) {
      return
    }

    await this.repairTurnFailure(
      snapshot.error ??
        new Error("Runtime stopped before clearing the streaming state.")
    )
  }

  private async recoverFromHandlerError(error: Error): Promise<void> {
    if (this.isDisposed() || this.recoveringFromHandlerError) {
      return
    }

    this.recoveringFromHandlerError = true
    this.watchdogError = error
    this.lastTerminalStatus = "error"
    this.agent.abort()

    try {
      await this.repairTurnFailure(error)
    } finally {
      this.recoveringFromHandlerError = false
    }
  }

  private enqueueEvent(event: AgentEvent): void {
    const snapshot = this.snapshotAgentState()
    const run = this.eventQueue.then(async () => {
      if (this.disposed) {
        return
      }

      await this.handleEvent(event, snapshot)
    })

    this.eventQueue = run.catch(async (error) => {
      const nextError =
        error instanceof Error ? error : new Error(String(error))
      console.error(
        `[agent-host] Unhandled error in event handler (session ${this.session.id}):`,
        nextError
      )

      try {
        await this.recoverFromHandlerError(nextError)
      } catch (recoveryError) {
        console.error(
          `[agent-host] Failed to recover from event handler error (session ${this.session.id}):`,
          recoveryError
        )
      }
    })
  }

  private async flushEventQueue(): Promise<void> {
    await this.eventQueue
  }

  private async repairTurnFailure(error: Error | string): Promise<void> {
    if (this.isDisposed()) {
      return
    }

    const normalizedError = toError(error)
    this.lastTerminalStatus = "error"
    const repairedRows = await this.buildRepairRows(normalizedError.message)
    const nextSession = buildPersistedSession(
      {
        ...this.session,
        error: undefined,
        isStreaming: false,
        updatedAt: getIsoNow(),
      },
      repairedRows
    )

    this.session = nextSession
    this.persistQueue = this.persistQueue.then(async () => {
      if (this.isDisposed()) {
        return
      }

      await replaceSessionMessages(this.session, repairedRows)
      this.persistedMessageIds.clear()

      for (const message of repairedRows) {
        this.persistedMessageIds.add(message.id)
      }
    })

    await this.persistQueue
    await markTurnCompleted({
      assistantMessageId: this.currentAssistantMessageId,
      lastError: normalizedError.message,
      sessionId: this.session.id,
      status: "error",
      turnId: this.currentTurnId,
    })
    await this.appendSystemNoticeFromError(normalizedError)
    this.clearActiveStreamPointers()
  }

  private async persistCurrentTurnBoundary(
    snapshot?: AgentStateSnapshot
  ): Promise<boolean> {
    return await this.persistCurrentTurnBoundaryFromSnapshot(
      snapshot ?? this.snapshotAgentState()
    )
  }

  private async persistCurrentTurnBoundaryFromSnapshot(
    snapshot: AgentStateSnapshot
  ): Promise<boolean> {
    if (this.isDisposed()) {
      return false
    }

    const currentAssistantId = this.currentAssistantMessageId

    if (!currentAssistantId) {
      return false
    }

    const currentRows = this.buildCurrentRows(snapshot)
    const terminalAssistant = currentRows.find(
      (
        row
      ): row is MessageRow & { role: "assistant" } =>
        row.id === currentAssistantId &&
        row.role === "assistant" &&
        row.status !== "streaming"
    )

    if (!terminalAssistant) {
      return false
    }

    const terminalStatus =
      terminalAssistant.status === "aborted" ||
      terminalAssistant.status === "completed" ||
      terminalAssistant.status === "error"
        ? terminalAssistant.status
        : "error"
    await this.persistSessionBoundary(
      {
        error: undefined,
        isStreaming: false,
      },
      [terminalAssistant],
      currentRows
    )
    await markTurnCompleted({
      assistantMessageId: terminalAssistant.id,
      lastError: terminalAssistant.errorMessage,
      sessionId: this.session.id,
      status: terminalStatus,
      turnId: this.currentTurnId,
    })

    if (terminalStatus === "error" && terminalAssistant.errorMessage) {
      await this.appendSystemNoticeFromError(
        new Error(terminalAssistant.errorMessage)
      )
    }
    this.clearActiveStreamPointers()
    return true
  }

  private async buildRepairRows(errorMessage: string): Promise<MessageRow[]> {
    const persistedRows = await getSessionMessages(this.session.id)
    const rowsById = new Map<string, MessageRow>()

    for (const row of persistedRows) {
      rowsById.set(row.id, row)
    }

    for (const row of this.buildCurrentRows()) {
      rowsById.set(row.id, row)
    }

    return pruneOrphanToolResults(
      [...rowsById.values()]
        .map((row) =>
          rewriteStreamingAssistantRow(this.session.id, row, errorMessage)
        )
        .sort(sortByTimestamp)
    )
  }

  private clearActiveStreamPointers(): void {
    this.currentAssistantMessageId = undefined
    this.currentTurnId = undefined
    this.lastDraftAssistant = undefined
    this.lastTerminalStatus = undefined
  }

  private isDisposed(): boolean {
    return this.disposed
  }

  private createRuntime(repoSource?: RepoSource, token?: string) {
    const normalized = normalizeRepoSource(repoSource)

    if (!normalized) {
      return undefined
    }

    const resolved =
      token !== undefined ? token : this.githubRuntimeTokenSnapshot

    return createRepoRuntime(normalized, { runtimeToken: resolved })
  }

  private getAgentTools(runtime = this.repoRuntime): AgentTool[] {
    if (!runtime) {
      return []
    }

    return createRepoTools(runtime, {
      onRepoError: (error) =>
        this.appendSystemNoticeFromError(
          error instanceof Error ? error : new Error(String(error))
        ),
    }).agentTools
  }

  private async appendSystemNoticeFromError(error: Error): Promise<void> {
    if (this.disposed) {
      return
    }

    await appendSessionNotice(this.session.id, error)
  }

  private markProgress(): void {
    this.lastProgressAt = Date.now()
  }

  private startWatchdog(): void {
    this.stopWatchdog()
    this.markProgress()
    this.watchdogInterval = setInterval(() => {
      if (this.disposed || !this.isBusy()) {
        this.stopWatchdog()
        return
      }

      if (Date.now() - this.lastProgressAt < TURN_IDLE_TIMEOUT_MS) {
        return
      }

      this.watchdogError = new Error(
        "Runtime timed out after no progress."
      )
      this.lastTerminalStatus = "error"
      this.agent.abort()
      this.stopWatchdog()
    }, TURN_IDLE_POLL_MS)
  }

  private stopWatchdog(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval)
      this.watchdogInterval = undefined
    }
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

  private seedAssignedAssistantIds(messages: Array<MessageRow>): void {
    for (const message of messages) {
      if (message.role !== "assistant") {
        continue
      }

      this.assignedAssistantIds.set(message.id, message.id)
    }
  }

  private snapshotAgentState(): AgentStateSnapshot {
    return {
      error: this.agent.state.error,
      isStreaming: this.agent.state.isStreaming,
      messages: cloneValue(this.agent.state.messages),
      streamMessage:
        this.agent.state.streamMessage === null
          ? null
          : cloneValue(this.agent.state.streamMessage),
    }
  }

  private resolveAssistantRowId(
    message: PiAssistantMessage
  ): string | undefined {
    const sourceId =
      "id" in message && typeof message.id === "string"
        ? message.id
        : undefined
    const assignedId = sourceId
      ? this.assignedAssistantIds.get(sourceId)
      : undefined

    if (assignedId) {
      return assignedId
    }

    if (!this.currentAssistantMessageId) {
      return sourceId
    }

    if (sourceId) {
      this.assignedAssistantIds.set(sourceId, this.currentAssistantMessageId)
    }
    return this.currentAssistantMessageId
  }

  private async recordAssistantUsage(
    message: PiAssistantMessage,
    messageId: string
  ): Promise<void> {
    if (this.isDisposed()) {
      return
    }

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

  private buildCompletedRows(
    messages: AgentMessage[] = this.agent.state.messages
  ): Array<MessageRow> {
    const normalizedMessages = normalizeMessages(messages)
    const currentAssistantId = this.currentAssistantMessageId

    if (currentAssistantId) {
      for (let index = normalizedMessages.length - 1; index >= 0; index -= 1) {
        const message = normalizedMessages[index]

        if (
          message?.role === "assistant" &&
          !this.assignedAssistantIds.has(message.id)
        ) {
          this.assignedAssistantIds.set(message.id, currentAssistantId)
          break
        }
      }
    }

    let activeAssistantId: string | undefined

    return normalizedMessages.map((message) => {
      let messageId = message.id

      if (message.role === "assistant") {
        messageId = this.assignedAssistantIds.get(message.id) ?? message.id
        activeAssistantId = messageId
      }

      const row = toMessageRow(
        this.session.id,
        message,
        inferMessageStatus(message),
        messageId
      )

      if (row.role === "toolResult" && activeAssistantId) {
        row.parentAssistantId = activeAssistantId
      }

      return row
    })
  }

  private buildCurrentAssistantRow(
    snapshot: AgentStateSnapshot = this.snapshotAgentState()
  ): MessageRow | undefined {
    const draft = normalizeAssistantDraft(snapshot.streamMessage)

    if (draft) {
      this.lastDraftAssistant = draft
    }

    const currentAssistantId = this.currentAssistantMessageId
    const lastDraftAssistant = this.lastDraftAssistant

    if (!currentAssistantId || !lastDraftAssistant) {
      return undefined
    }

    if (snapshot.isStreaming) {
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

    if (!this.lastTerminalStatus) {
      return undefined
    }

    return toMessageRow(
      this.session.id,
      {
        ...lastDraftAssistant,
        errorMessage:
          this.lastTerminalStatus === "error"
            ? snapshot.error ?? lastDraftAssistant.errorMessage
            : lastDraftAssistant.errorMessage,
        id: currentAssistantId,
        model: this.session.model,
        provider: this.session.provider,
        stopReason: this.lastTerminalStatus === "aborted" ? "aborted" : "error",
      },
      this.lastTerminalStatus,
      currentAssistantId
    )
  }

  private buildCurrentRows(
    snapshot: AgentStateSnapshot = this.snapshotAgentState()
  ): Array<MessageRow> {
    const rowsById = new Map<string, MessageRow>()

    for (const row of this.buildCompletedRows(snapshot.messages)) {
      rowsById.set(row.id, row)
    }

    const currentAssistantRow = this.buildCurrentAssistantRow(snapshot)

    if (currentAssistantRow) {
      rowsById.set(currentAssistantRow.id, currentAssistantRow)
    }

    return [...rowsById.values()].sort(sortByTimestamp)
  }

  private getNewlyCompletedRows(
    snapshot: AgentStateSnapshot = this.snapshotAgentState()
  ): Array<MessageRow> {
    return this.buildCompletedRows(snapshot.messages).filter(
      (message) => !this.persistedMessageIds.has(message.id)
    )
  }

  private async persistPromptStart(
    userRow: MessageRow,
    assistantRow: MessageRow
  ): Promise<void> {
    const snapshot = this.snapshotAgentState()

    await this.persistSessionBoundary(
      {
        error: undefined,
        isStreaming: true,
      },
      [userRow, assistantRow],
      [...this.buildCompletedRows(snapshot.messages), userRow, assistantRow]
    )
  }

  private async persistStreamingProgress(
    currentAssistantRow: MessageRow | undefined,
    newlyCompletedRows: Array<MessageRow>
  ): Promise<void> {
    if (this.isDisposed()) {
      return
    }

    this.persistQueue = this.persistQueue.then(async () => {
      if (this.isDisposed()) {
        return
      }

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

      if (currentAssistantRow || newlyCompletedRows.length > 0) {
        await markTurnProgress({
          assistantMessageId:
            currentAssistantRow?.role === "assistant"
              ? currentAssistantRow.id
              : this.currentAssistantMessageId,
          sessionId: this.session.id,
          turnId: this.currentTurnId,
        })
      }
    })

    await this.persistQueue
  }

  private async persistSessionBoundary(
    overrides: Pick<SessionData, "error" | "isStreaming">,
    changedMessages: Array<MessageRow>,
    rowsForDerivation?: Array<MessageRow>
  ): Promise<void> {
    if (this.isDisposed()) {
      return
    }

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

    if (this.isDisposed()) {
      return
    }

    this.session = buildPersistedSession(nextSessionBase, allRows)

    this.persistQueue = this.persistQueue.then(async () => {
      if (this.isDisposed()) {
        return
      }

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
}
