import type { ProviderGroupId, ThinkingLevel } from "@gitinspect/pi/types/models";
import type { SessionData } from "@gitinspect/db";
import {
  BusyRuntimeError,
  MissingSessionRuntimeError,
} from "@gitinspect/pi/agent/runtime-command-errors";
import { getRuntimeWorker } from "@gitinspect/pi/agent/runtime-worker-client";
import type { SessionRunner } from "@gitinspect/pi/agent/session-runner";
import { WorkerBackedAgentHost } from "@gitinspect/pi/agent/worker-backed-agent-host";
import {
  claimSessionLease,
  LEASE_HEARTBEAT_MS,
  loadSessionLeaseState,
  releaseOwnedSessionLeases,
  releaseSessionLease,
  renewSessionLease,
} from "@gitinspect/db/session-leases";
import { loadSession } from "@gitinspect/pi/sessions/session-service";
import { reconcileInterruptedSession } from "@gitinspect/pi/sessions/session-notices";
import { loadSessionViewModel } from "@gitinspect/pi/sessions/session-view-model";
import {
  type ActiveSessionViewState,
  deriveActiveSessionViewState,
  deriveRecoveryIntent,
} from "@gitinspect/pi/sessions/session-view-state";

export type InterruptedResumeMode = "continue" | "retry";

const CONTINUE_INTERRUPTED_PROMPT = "Continue your last response from where it stopped.";
const RETRY_INTERRUPTED_PROMPT = "Please answer my previous message again.";

function isSessionLockedMessage(error: Error): boolean {
  return error.message === "This session is active in another tab.";
}

function assertTurnMutationAllowed(
  sessionId: string,
  state: ActiveSessionViewState,
  options: { allowRecovering: boolean },
): void {
  if (state.kind === "running-local") {
    throw new BusyRuntimeError(sessionId);
  }

  if (state.kind === "running-remote") {
    throw new Error("This session is active in another tab.");
  }

  if (!options.allowRecovering && state.kind === "recovering") {
    throw new Error("This session is active in another tab.");
  }
}

export class RuntimeClient {
  private readonly activeTurns = new Map<string, SessionRunner>();
  private readonly leaseHeartbeats = new Map<string, ReturnType<typeof setInterval>>();
  private listenersInstalled = false;

  constructor() {
    this.installListeners();
  }

  private installListeners(): void {
    if (this.listenersInstalled || typeof window === "undefined") {
      return;
    }

    const release = () => {
      void this.releaseAll();
    };

    window.addEventListener("beforeunload", release);
    window.addEventListener("pagehide", release);
    document.addEventListener("freeze", release as EventListener);
    this.listenersInstalled = true;
  }

  private async createHost(session: SessionData): Promise<SessionRunner> {
    return new WorkerBackedAgentHost(session);
  }

  private async claimOwnership(
    sessionId: string,
    options: { keepAlive?: boolean } = {},
  ): Promise<void> {
    const claimed = await claimSessionLease(sessionId);

    if (claimed.kind === "locked") {
      throw new Error("This session is active in another tab.");
    }

    if (options.keepAlive !== false) {
      this.startLeaseHeartbeat(sessionId);
    }
  }

  private startLeaseHeartbeat(sessionId: string): void {
    if (this.leaseHeartbeats.has(sessionId)) {
      return;
    }

    const interval = setInterval(() => {
      void renewSessionLease(sessionId);
    }, LEASE_HEARTBEAT_MS);

    this.leaseHeartbeats.set(sessionId, interval);
  }

  private stopLeaseHeartbeat(sessionId: string): void {
    const interval = this.leaseHeartbeats.get(sessionId);

    if (!interval) {
      return;
    }

    clearInterval(interval);
    this.leaseHeartbeats.delete(sessionId);
  }

  private watchActiveTurn(sessionId: string, host: SessionRunner): void {
    void host
      .waitForTurn()
      .catch((error) => {
        if (error instanceof Error && !isSessionLockedMessage(error)) {
          console.error("[gitinspect:runtime] turn_watch_failed", {
            error,
            sessionId,
          });
        }
      })
      .finally(() => {
        void this.finishActiveTurn(sessionId, host);
      });
  }

  private async finishActiveTurn(sessionId: string, host: SessionRunner): Promise<void> {
    if (this.activeTurns.get(sessionId) !== host) {
      return;
    }

    await host.dispose();
    this.activeTurns.delete(sessionId);
    this.stopLeaseHeartbeat(sessionId);
    await releaseSessionLease(sessionId);
  }

  private async loadPersistedState(sessionId: string): Promise<{
    state: ReturnType<typeof deriveActiveSessionViewState>;
    viewModel: NonNullable<Awaited<ReturnType<typeof loadSessionViewModel>>>;
  }> {
    const viewModel = await loadSessionViewModel(sessionId);

    if (!viewModel) {
      throw new MissingSessionRuntimeError(sessionId);
    }

    const leaseState = await loadSessionLeaseState(sessionId);
    const state = deriveActiveSessionViewState({
      hasLocalRunner: this.hasActiveTurn(sessionId),
      hasPartialAssistantText: viewModel.hasPartialAssistantText,
      lastProgressAt: viewModel.runtime?.lastProgressAt,
      leaseState,
      runtimePhase: viewModel.runtime?.phase,
      runtimeStatus: viewModel.runtime?.status,
      sessionIsStreaming: viewModel.session.isStreaming,
    });

    return { state, viewModel };
  }

  private async loadMutationSession(sessionId: string): Promise<SessionData> {
    let { state } = await this.loadPersistedState(sessionId);

    assertTurnMutationAllowed(sessionId, state, { allowRecovering: true });

    if (deriveRecoveryIntent(state) === "run-now") {
      await reconcileInterruptedSession(sessionId, {
        hasLocalRunner: false,
      });
      ({ state } = await this.loadPersistedState(sessionId));
    }

    assertTurnMutationAllowed(sessionId, state, { allowRecovering: false });

    await this.claimOwnership(sessionId, { keepAlive: false });
    const reloaded = await loadSession(sessionId);

    if (!reloaded) {
      await releaseSessionLease(sessionId);
      throw new MissingSessionRuntimeError(sessionId);
    }

    return reloaded;
  }

  async startTurn(sessionId: string, content: string): Promise<void> {
    const existing = this.activeTurns.get(sessionId);

    if (existing?.isBusy()) {
      throw new BusyRuntimeError(sessionId);
    }

    const session = await this.loadMutationSession(sessionId);
    const host = await this.createHost(session);
    this.activeTurns.set(sessionId, host);

    try {
      await host.startTurn(content);
      this.startLeaseHeartbeat(sessionId);
      this.watchActiveTurn(sessionId, host);
    } catch (error) {
      await host.dispose();
      this.activeTurns.delete(sessionId);
      this.stopLeaseHeartbeat(sessionId);
      await releaseSessionLease(sessionId);
      throw error;
    }
  }

  async startInitialTurn(session: SessionData, content: string): Promise<void> {
    await this.claimOwnership(session.id);
    const host = await this.createHost(session);
    this.activeTurns.set(session.id, host);

    try {
      await host.startTurn(content);
      this.watchActiveTurn(session.id, host);
    } catch (error) {
      await host.dispose();
      this.activeTurns.delete(session.id);
      this.stopLeaseHeartbeat(session.id);
      await releaseSessionLease(session.id);
      throw error;
    }
  }

  async abort(sessionId: string): Promise<void> {
    const host = this.activeTurns.get(sessionId);

    if (!host) {
      return;
    }

    await this.claimOwnership(sessionId);
    await host.abort();
  }

  hasActiveTurn(sessionId: string): boolean {
    return this.activeTurns.get(sessionId)?.isBusy() ?? false;
  }

  async releaseSessionAndDrain(sessionId: string): Promise<void> {
    const host = this.activeTurns.get(sessionId);

    if (host) {
      await host.dispose();
      this.activeTurns.delete(sessionId);
    } else {
      await getRuntimeWorker().disposeSession(sessionId);
    }

    this.stopLeaseHeartbeat(sessionId);
    await releaseSessionLease(sessionId);
  }

  async releaseSession(sessionId: string): Promise<void> {
    await this.releaseSessionAndDrain(sessionId);
  }

  async releaseAll(): Promise<void> {
    const hosts = [...this.activeTurns.values()];

    for (const host of hosts) {
      await host.dispose();
    }

    this.activeTurns.clear();

    for (const [sessionId] of this.leaseHeartbeats) {
      this.stopLeaseHeartbeat(sessionId);
    }

    await releaseOwnedSessionLeases();
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string,
  ): Promise<void> {
    const host = this.activeTurns.get(sessionId);

    if (host?.isBusy()) {
      throw new BusyRuntimeError(sessionId);
    }

    await this.claimOwnership(sessionId, { keepAlive: false });

    try {
      if (host) {
        await host.setModelSelection(providerGroup, modelId);
        return;
      }

      await getRuntimeWorker().setModelSelection({
        modelId,
        providerGroup,
        sessionId,
      });
    } finally {
      if (!this.hasActiveTurn(sessionId)) {
        await releaseSessionLease(sessionId);
      }
    }
  }

  async setThinkingLevel(sessionId: string, thinkingLevel: ThinkingLevel): Promise<void> {
    const host = this.activeTurns.get(sessionId);

    if (host?.isBusy()) {
      throw new BusyRuntimeError(sessionId);
    }

    await this.claimOwnership(sessionId, { keepAlive: false });

    try {
      if (host) {
        await host.setThinkingLevel(thinkingLevel);
        return;
      }

      await getRuntimeWorker().setThinkingLevel({
        sessionId,
        thinkingLevel,
      });
    } finally {
      if (!this.hasActiveTurn(sessionId)) {
        await releaseSessionLease(sessionId);
      }
    }
  }

  async resumeInterruptedTurn(sessionId: string, mode: InterruptedResumeMode): Promise<void> {
    const { state } = await this.loadPersistedState(sessionId);

    if (state.kind !== "interrupted") {
      throw new Error("This session is not interrupted.");
    }

    await this.startTurn(
      sessionId,
      mode === "continue" ? CONTINUE_INTERRUPTED_PROMPT : RETRY_INTERRUPTED_PROMPT,
    );
  }
}

export const runtimeClient = new RuntimeClient();
