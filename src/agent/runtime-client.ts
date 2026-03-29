import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { MessageRow, SessionData } from "@/types/storage"
import { AgentHost } from "@/agent/agent-host"
import {
  claimSessionLease,
  LEASE_HEARTBEAT_MS,
  loadSessionLeaseState,
  releaseOwnedSessionLeases,
  releaseSessionLease,
  renewSessionLease,
} from "@/db/session-leases"
import {
  BusyRuntimeError,
  MissingSessionRuntimeError,
} from "@/agent/runtime-command-errors"
import { getSessionRuntime, putSession } from "@/db/schema"
import { getIsoNow } from "@/lib/dates"
import { getCanonicalProvider } from "@/models/catalog"
import { getGithubPersonalAccessToken } from "@/repo/github-token"
import { loadSession, loadSessionWithMessages } from "@/sessions/session-service"
import { reconcileInterruptedSession } from "@/sessions/session-notices"
import {
  type ActiveSessionViewState,
  deriveActiveSessionViewState,
  deriveRecoveryIntent,
} from "@/sessions/session-view-state"

export type InterruptedResumeMode = "continue" | "retry"

const CONTINUE_INTERRUPTED_PROMPT =
  "Continue your last response from where it stopped."
const RETRY_INTERRUPTED_PROMPT =
  "Please answer my previous message again."

function isSessionLockedMessage(error: Error): boolean {
  return error.message === "This session is active in another tab."
}

function assertTurnMutationAllowed(
  sessionId: string,
  state: ActiveSessionViewState,
  options: { allowRecovering: boolean }
): void {
  if (state.kind === "running-local") {
    throw new BusyRuntimeError(sessionId)
  }

  if (state.kind === "running-remote") {
    throw new Error("This session is active in another tab.")
  }

  if (!options.allowRecovering && state.kind === "recovering") {
    throw new Error("This session is active in another tab.")
  }
}

export class RuntimeClient {
  private readonly activeTurns = new Map<string, AgentHost>()
  private readonly leaseHeartbeats = new Map<
    string,
    ReturnType<typeof setInterval>
  >()
  private listenersInstalled = false

  constructor() {
    this.installListeners()
  }

  private installListeners(): void {
    if (
      this.listenersInstalled ||
      typeof window === "undefined"
    ) {
      return
    }

    const release = () => {
      void this.releaseAll()
    }

    window.addEventListener("beforeunload", release)
    window.addEventListener("pagehide", release)
    this.listenersInstalled = true
  }

  private async createHost(
    session: SessionData,
    messages: MessageRow[]
  ): Promise<AgentHost> {
    const githubRuntimeToken = await getGithubPersonalAccessToken()
    const host = new AgentHost(session, messages, {
      getGithubToken: getGithubPersonalAccessToken,
      githubRuntimeToken,
    })
    return host
  }

  private async claimOwnership(
    sessionId: string,
    options: { keepAlive?: boolean } = {}
  ): Promise<void> {
    const claimed = await claimSessionLease(sessionId)

    if (claimed.kind === "locked") {
      throw new Error("This session is active in another tab.")
    }

    if (options.keepAlive !== false) {
      this.startLeaseHeartbeat(sessionId)
    }
  }

  private startLeaseHeartbeat(sessionId: string): void {
    if (this.leaseHeartbeats.has(sessionId)) {
      return
    }

    const interval = setInterval(() => {
      void renewSessionLease(sessionId)
    }, LEASE_HEARTBEAT_MS)

    this.leaseHeartbeats.set(sessionId, interval)
  }

  private stopLeaseHeartbeat(sessionId: string): void {
    const interval = this.leaseHeartbeats.get(sessionId)

    if (!interval) {
      return
    }

    clearInterval(interval)
    this.leaseHeartbeats.delete(sessionId)
  }

  private watchActiveTurn(sessionId: string, host: AgentHost): void {
    void host
      .waitForTurn()
      .catch((error) => {
        if (
          error instanceof Error &&
          !isSessionLockedMessage(error)
        ) {
          console.error("[gitinspect:runtime] turn_watch_failed", {
            error,
            sessionId,
          })
        }
      })
      .finally(() => {
        if (this.activeTurns.get(sessionId) !== host) {
          return
        }

        host.dispose()
        this.activeTurns.delete(sessionId)
        this.stopLeaseHeartbeat(sessionId)
        void releaseSessionLease(sessionId)
      })
  }

  private async loadPersistedState(sessionId: string): Promise<{
    loaded: { messages: MessageRow[]; session: SessionData }
    state: ReturnType<typeof deriveActiveSessionViewState>
  }> {
    const loaded = await loadSessionWithMessages(sessionId)

    if (!loaded) {
      throw new MissingSessionRuntimeError(sessionId)
    }

    const [leaseState, runtime] = await Promise.all([
      loadSessionLeaseState(sessionId),
      getSessionRuntime(sessionId),
    ])
    const state = deriveActiveSessionViewState({
      hasLocalRunner: this.hasActiveTurn(sessionId),
      hasPartialAssistantText: false,
      lastProgressAt: runtime?.lastProgressAt,
      leaseState,
      runtimeStatus: runtime?.status,
      sessionIsStreaming: loaded.session.isStreaming,
    })

    return { loaded, state }
  }

  private async loadMutationSession(
    sessionId: string
  ): Promise<{ messages: MessageRow[]; session: SessionData }> {
    let { state } = await this.loadPersistedState(sessionId)

    assertTurnMutationAllowed(sessionId, state, { allowRecovering: true })

    if (deriveRecoveryIntent(state) === "run-now") {
      await reconcileInterruptedSession(sessionId, {
        hasLocalRunner: false,
      })
      ;({ state } = await this.loadPersistedState(sessionId))
    }

    assertTurnMutationAllowed(sessionId, state, { allowRecovering: false })

    await this.claimOwnership(sessionId, { keepAlive: false })
    const reloaded = await loadSessionWithMessages(sessionId)

    if (!reloaded) {
      await releaseSessionLease(sessionId)
      throw new MissingSessionRuntimeError(sessionId)
    }

    return reloaded
  }

  async startTurn(sessionId: string, content: string): Promise<void> {
    const existing = this.activeTurns.get(sessionId)

    if (existing?.isBusy()) {
      throw new BusyRuntimeError(sessionId)
    }

    const loaded = await this.loadMutationSession(sessionId)
    const host = await this.createHost(loaded.session, loaded.messages)
    this.activeTurns.set(sessionId, host)

    try {
      await host.startTurn(content)
      this.startLeaseHeartbeat(sessionId)
      this.watchActiveTurn(sessionId, host)
    } catch (error) {
      host.dispose()
      this.activeTurns.delete(sessionId)
      this.stopLeaseHeartbeat(sessionId)
      await releaseSessionLease(sessionId)
      throw error
    }
  }

  async startInitialTurn(
    session: SessionData,
    content: string
  ): Promise<void> {
    await this.claimOwnership(session.id)
    const host = await this.createHost(session, [])
    this.activeTurns.set(session.id, host)

    try {
      await host.startTurn(content)
      this.watchActiveTurn(session.id, host)
    } catch (error) {
      host.dispose()
      this.activeTurns.delete(session.id)
      this.stopLeaseHeartbeat(session.id)
      await releaseSessionLease(session.id)
      throw error
    }
  }

  async abort(sessionId: string): Promise<void> {
    const host = this.activeTurns.get(sessionId)

    if (!host) {
      return
    }

    await this.claimOwnership(sessionId)
    host.abort()
  }

  hasActiveTurn(sessionId: string): boolean {
    return this.activeTurns.get(sessionId)?.isBusy() ?? false
  }

  async releaseSession(sessionId: string): Promise<void> {
    const host = this.activeTurns.get(sessionId)

    host?.dispose()
    this.activeTurns.delete(sessionId)
    this.stopLeaseHeartbeat(sessionId)
    await releaseSessionLease(sessionId)
  }

  async releaseAll(): Promise<void> {
    for (const host of this.activeTurns.values()) {
      host.dispose()
    }

    this.activeTurns.clear()

    for (const [sessionId] of this.leaseHeartbeats) {
      this.stopLeaseHeartbeat(sessionId)
    }

    await releaseOwnedSessionLeases()
  }

  async refreshGithubToken(sessionId: string): Promise<void> {
    const host = this.activeTurns.get(sessionId)

    if (!host) {
      return
    }

    await host.refreshGithubToken()
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void> {
    const host = this.activeTurns.get(sessionId)

    if (host?.isBusy()) {
      throw new BusyRuntimeError(sessionId)
    }

    await this.claimOwnership(sessionId, { keepAlive: false })

    try {
      if (host) {
        await host.setModelSelection(providerGroup, modelId)
        return
      }

      const session = await loadSession(sessionId)

      if (!session) {
        throw new MissingSessionRuntimeError(sessionId)
      }

      await putSession({
        ...session,
        error: undefined,
        model: modelId,
        provider: getCanonicalProvider(providerGroup),
        providerGroup,
        updatedAt: getIsoNow(),
      })
    } finally {
      if (!this.hasActiveTurn(sessionId)) {
        await releaseSessionLease(sessionId)
      }
    }
  }

  async setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<void> {
    const host = this.activeTurns.get(sessionId)

    if (host?.isBusy()) {
      throw new BusyRuntimeError(sessionId)
    }

    await this.claimOwnership(sessionId, { keepAlive: false })

    try {
      if (host) {
        await host.setThinkingLevel(thinkingLevel)
        return
      }

      const session = await loadSession(sessionId)

      if (!session) {
        throw new MissingSessionRuntimeError(sessionId)
      }

      await putSession({
        ...session,
        thinkingLevel,
        updatedAt: getIsoNow(),
      })
    } finally {
      if (!this.hasActiveTurn(sessionId)) {
        await releaseSessionLease(sessionId)
      }
    }
  }

  async resumeInterruptedTurn(
    sessionId: string,
    mode: InterruptedResumeMode
  ): Promise<void> {
    const { state } = await this.loadPersistedState(sessionId)

    if (state.kind !== "interrupted") {
      throw new Error("This session is not interrupted.")
    }

    await this.startTurn(
      sessionId,
      mode === "continue"
        ? CONTINUE_INTERRUPTED_PROMPT
        : RETRY_INTERRUPTED_PROMPT
    )
  }
}

export const runtimeClient = new RuntimeClient()
