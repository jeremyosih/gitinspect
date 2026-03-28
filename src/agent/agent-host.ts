import { Agent } from "@mariozechner/pi-agent-core"
import type { AgentEvent } from "@mariozechner/pi-agent-core"
import type { Message } from "@mariozechner/pi-ai"
import type { TerminalAssistantStatus } from "@/agent/session-persistence"
import type { AssistantMessage } from "@/types/chat"
import type { ProviderGroupId, ProviderId, ThinkingLevel } from "@/types/models"
import type { MessageRow, RepoSource, SessionData } from "@/types/storage"
import { putSession } from "@/db/schema"
import { webMessageTransformer } from "@/agent/message-transformer"
import { streamChatWithPiAgent } from "@/agent/provider-stream"
import { SessionPersistence } from "@/agent/session-persistence"
import { buildInitialAgentState, toMessageRow } from "@/agent/session-adapter"
import { resolveApiKeyForProvider } from "@/auth/resolve-api-key"
import { getIsoNow } from "@/lib/dates"
import { createId } from "@/lib/ids"
import { logRuntimeDebug } from "@/lib/runtime-debug"
import { getCanonicalProvider, getModel } from "@/models/catalog"
import { createRepoRuntime } from "@/repo/repo-runtime"
import { normalizeRepoSource } from "@/repo/settings"
import { appendSessionNotice } from "@/sessions/session-notices"
import { createRepoTools } from "@/tools"

export class AgentHost {
  readonly agent: Agent

  private currentAssistantMessageId?: string
  private lastDraftAssistant?: AssistantMessage
  private lastTerminalStatus: TerminalAssistantStatus = undefined
  private disposed = false
  private promptPending = false
  private githubRuntimeTokenSnapshot?: string
  private getGithubToken?: () => Promise<string | undefined>
  private readonly persistence: SessionPersistence
  private repoRuntime
  private unsubscribe?: () => void

  constructor(
    session: SessionData,
    messages: Array<MessageRow>,
    options?: {
      getGithubToken?: () => Promise<string | undefined>
      githubRuntimeToken?: string
    }
  ) {
    this.githubRuntimeTokenSnapshot = options?.githubRuntimeToken
    this.getGithubToken = options?.getGithubToken
    this.repoRuntime = this.createRuntime(session.repoSource)
    this.persistence = new SessionPersistence(
      session,
      {
        getCurrentAssistantId: () => this.currentAssistantMessageId,
        getError: () => this.agent.state.error,
        getLastDraftAssistant: () => this.lastDraftAssistant,
        getLastTerminalStatus: () => this.lastTerminalStatus,
        getMessages: () => this.agent.state.messages,
        getStreamMessage: () => this.agent.state.streamMessage,
        isStreaming: () => this.agent.state.isStreaming,
        setLastDraftAssistant: (message) => {
          this.lastDraftAssistant = message
        },
      },
      messages
    )

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
      void this.handleEvent(event).catch((error) => {
        console.error(
          `[agent-host] Unhandled error in event handler (session ${this.session.id}):`,
          error
        )
      })
    })
  }

  private get session(): SessionData {
    return this.persistence.getSession()
  }

  private set session(session: SessionData) {
    this.persistence.setSession(session)
  }

  isBusy(): boolean {
    return this.promptPending || this.agent.state.isStreaming
  }

  async prompt(content: string): Promise<void> {
    const trimmed = content.trim()

    if (!trimmed || this.disposed) {
      return
    }

    const timestamp = Date.now()
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
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: {
          cacheRead: 0,
          cacheWrite: 0,
          input: 0,
          output: 0,
          total: 0,
        },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    }
    this.lastTerminalStatus = undefined
    this.promptPending = true

    const userRow = toMessageRow(this.session.id, userMessage)
    const assistantRow = toMessageRow(
      this.session.id,
      this.lastDraftAssistant,
      "streaming",
      this.currentAssistantMessageId
    )
    await this.persistence.persistPromptStart(userRow, assistantRow)
    logRuntimeDebug("prompt_persisted", {
      assistantMessageId: assistantRow.id,
      sessionId: this.session.id,
      userMessageId: userRow.id,
    })

    try {
      await this.agent.prompt(userMessage)
    } catch (error) {
      if (this.isDisposed()) {
        return
      }

      await this.appendSystemNoticeFromError(error)
      this.lastTerminalStatus = "error"
      this.session = {
        ...this.session,
        error: undefined,
        isStreaming: false,
        updatedAt: getIsoNow(),
      }

      const currentAssistantRow = this.persistence.buildCurrentAssistantRow()
      const currentRows = this.persistence.buildCurrentRows()

      await this.persistence.persistSessionBoundary(
        {
          bootstrapStatus: this.session.bootstrapStatus,
          error: undefined,
          isStreaming: false,
        },
        currentAssistantRow ? [currentAssistantRow] : [],
        currentRows
      )
      this.clearActiveStreamPointers()
    } finally {
      this.promptPending = false

      await this.persistence.flush()

      if (!this.isDisposed() && this.session.isStreaming) {
        console.warn(
          `[agent-host] Safety net: session ${this.session.id} still marked isStreaming after prompt resolved, forcing off`
        )
        this.session = {
          ...this.session,
          error: undefined,
          isStreaming: false,
          updatedAt: getIsoNow(),
        }
        await putSession(this.session)
        this.clearActiveStreamPointers()
      }
    }
  }

  /** Await queued Dexie writes (useful after async agent events in tests). */
  async flushPersistence(): Promise<void> {
    await this.persistence.flush()
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
    this.persistence.dispose()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.abort()
  }

  private async handleEvent(event: AgentEvent): Promise<void> {
    if (this.disposed) {
      return
    }

    if (!this.agent.state.isStreaming && this.agent.state.error) {
      this.lastTerminalStatus ??= "error"
      void this.appendSystemNoticeFromError(new Error(this.agent.state.error))
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
      const recordedId =
        this.currentAssistantMessageId ??
        ("id" in event.message && typeof event.message.id === "string"
          ? event.message.id
          : undefined)

      if (recordedId) {
        await this.persistence.recordAssistantUsage(event.message, recordedId)
      }
    }

    if (this.agent.state.isStreaming) {
      const currentAssistantRow = this.persistence.buildCurrentAssistantRow()
      const newlyCompletedRows = this.persistence.getNewlyCompletedRows()

      if (currentAssistantRow || newlyCompletedRows.length > 0) {
        await this.persistence.persistStreamingProgress(
          currentAssistantRow,
          newlyCompletedRows
        )
      }

      if (event.type === "turn_end" && event.toolResults.length > 0) {
        this.currentAssistantMessageId = createId()
        this.lastDraftAssistant = undefined
      }

      return
    }

    const currentAssistantRow = this.persistence.buildCurrentAssistantRow()
    const currentRows = this.persistence.buildCurrentRows()
    const changedMessages =
      currentAssistantRow
        ? [currentAssistantRow]
        : this.currentAssistantMessageId
          ? currentRows.filter((row) => row.id === this.currentAssistantMessageId)
          : []

    await this.persistence.persistSessionBoundary(
      {
        bootstrapStatus: this.session.bootstrapStatus,
        error: undefined,
        isStreaming: false,
      },
      changedMessages,
      currentRows
    )
    this.clearActiveStreamPointers()
  }

  private clearActiveStreamPointers(): void {
    this.currentAssistantMessageId = undefined
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

  private getAgentTools(runtime = this.repoRuntime) {
    if (!runtime) {
      return []
    }

    return createRepoTools(runtime, {
      onRepoError: (error) => this.appendSystemNoticeFromError(error),
    }).agentTools
  }

  private async appendSystemNoticeFromError(error: unknown): Promise<void> {
    if (this.disposed) {
      return
    }

    await appendSessionNotice(this.session.id, error)
  }
}
