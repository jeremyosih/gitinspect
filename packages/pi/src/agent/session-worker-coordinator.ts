import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent, AgentTool, StreamFn } from "@mariozechner/pi-agent-core";
import {
  BusyRuntimeError,
  StreamInterruptedRuntimeError,
} from "@gitinspect/pi/agent/runtime-command-errors";
import {
  normalizeAssistantDraft,
  normalizeMessages,
  buildInitialAgentState,
} from "@gitinspect/pi/agent/session-adapter";
import { TurnEventStore } from "@gitinspect/pi/agent/turn-event-store";
import {
  type AppendSessionNoticeInput,
  type ConfigureSessionInput,
  type ReconcileInterruptedSessionInput,
  type SetThinkingLevelInput,
  type StartTurnInput,
  type TurnCompletionResult,
} from "@gitinspect/pi/agent/runtime-worker-types";
import { shouldStopStreamingForRuntimeError } from "@gitinspect/pi/agent/runtime-errors";
import { webMessageTransformer } from "@gitinspect/pi/agent/message-transformer";
import { streamChatWithPiAgent } from "@gitinspect/pi/agent/provider-stream";
import { isFreeTierProxyMarker } from "@gitinspect/pi/auth/public-provider-fallbacks";
import { resolveApiKeyForProvider } from "@gitinspect/pi/auth/resolve-api-key";
import { putSession } from "@gitinspect/db";
import { getIsoNow } from "@gitinspect/pi/lib/dates";
import { getCanonicalProvider, getModel } from "@gitinspect/pi/models/catalog";
import { createOptionalRepoRuntime } from "@gitinspect/pi/repo/repo-runtime";
import {
  loadSessionWithMessages,
  buildPersistedSession,
} from "@gitinspect/pi/sessions/session-service";
import { createRepoTools } from "@gitinspect/pi/tools/index";
import type { ProviderId } from "@gitinspect/pi/types/models";
import type { AssistantMessage, ToolResultMessage } from "@gitinspect/pi/types/chat";
import type { MessageRow, SessionData, SessionRuntimeRow } from "@gitinspect/db";

const TURN_IDLE_TIMEOUT_MS = 15 * 60_000;
const TURN_IDLE_POLL_MS = 30_000;
const STREAM_FLUSH_MS = 50;

type SessionWorkerSeed = {
  runtime?: SessionRuntimeRow;
  session: SessionData;
  transcriptMessages: MessageRow[];
};

class WorkerAgentRunner {
  readonly agent: Agent;
  readonly store: TurnEventStore;

  private disposed = false;
  private disposePromise?: Promise<void>;
  private disposeRequested = false;
  private finalizing = false;
  private promptPending = false;
  private runningTurn?: Promise<void>;
  private repoRuntime;
  private unsubscribe?: () => void;
  private lastProgressAt = 0;
  private watchdogInterval?: ReturnType<typeof setInterval>;
  private readonly sessionId: string;
  private eventQueue = Promise.resolve();
  private pendingAssistantStream?: {
    message: AssistantMessage;
    turnId: string;
  };
  private pendingTerminalResult?: TurnCompletionResult;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private latestResult?: TurnCompletionResult;
  private billFirstProxyRequestForTurn = false;

  constructor(store: TurnEventStore) {
    this.store = store;
    this.sessionId = store.session.id;
    this.repoRuntime = createOptionalRepoRuntime(store.session.repoSource);

    const model = getModel(store.session.provider, store.session.model);
    const streamFn: StreamFn = (llmModel, context, streamOptions) => {
      const shouldBillFirstProxyRequest =
        this.billFirstProxyRequestForTurn && isFreeTierProxyMarker(streamOptions?.apiKey ?? "");

      if (!shouldBillFirstProxyRequest) {
        return streamChatWithPiAgent(llmModel, context, streamOptions);
      }

      this.billFirstProxyRequestForTurn = false;

      return streamChatWithPiAgent(llmModel, context, {
        ...streamOptions,
        headers: {
          ...streamOptions?.headers,
          "x-gitinspect-bill-first": "1",
        },
      });
    };

    this.agent = new Agent({
      convertToLlm: webMessageTransformer,
      getApiKey: async (provider) =>
        await resolveApiKeyForProvider(provider as ProviderId, this.store.session.providerGroup),
      initialState: buildInitialAgentState(
        this.store.session,
        this.store.transcriptMessages,
        model,
        this.getAgentTools(this.repoRuntime),
      ),
      streamFn,
      toolExecution: "sequential",
    });
    this.agent.sessionId = this.sessionId;
    this.unsubscribe = this.agent.subscribe((event) => {
      this.enqueueEvent(event);
    });
  }

  isBusy(): boolean {
    return this.promptPending || this.runningTurn !== undefined || this.agent.state.isStreaming;
  }

  async startTurn(input: StartTurnInput): Promise<void> {
    if (this.disposed || this.disposeRequested) {
      return;
    }

    if (this.isBusy()) {
      throw new BusyRuntimeError(this.sessionId);
    }

    this.pendingTerminalResult = undefined;
    this.latestResult = undefined;
    this.billFirstProxyRequestForTurn = true;
    this.promptPending = true;
    await this.store.beginTurn({
      ownerTabId: input.ownerTabId,
      turn: input.turn,
    });
    this.markProgress();
    this.startWatchdog();
    this.runningTurn = this.runTurnToCompletion(input.turn).finally(() => {
      this.runningTurn = undefined;
    });
  }

  async waitForTurn(): Promise<TurnCompletionResult | undefined> {
    await this.runningTurn;
    return this.latestResult;
  }

  abort(): void {
    if (this.disposed) {
      return;
    }

    this.pendingTerminalResult = {
      sessionId: this.sessionId,
      status: "aborted",
    };
    this.agent.abort();
  }

  async setModelSelection(
    providerGroup: ConfigureSessionInput["providerGroup"],
    modelId: string,
  ): Promise<void> {
    if (this.disposed || this.disposeRequested) {
      return;
    }

    const provider = getCanonicalProvider(providerGroup);
    const model = getModel(provider, modelId);

    this.agent.setModel(model);
    this.agent.sessionId = this.sessionId;
    await persistSessionSettings(this.store, {
      model: modelId,
      provider,
      providerGroup,
    });
  }

  async setThinkingLevel(thinkingLevel: SetThinkingLevelInput["thinkingLevel"]): Promise<void> {
    if (this.disposed || this.disposeRequested) {
      return;
    }

    this.agent.setThinkingLevel(thinkingLevel);
    await persistSessionSettings(this.store, {
      thinkingLevel,
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (this.disposePromise) {
      return await this.disposePromise;
    }

    this.disposeRequested = true;
    this.disposePromise = (async () => {
      if (this.isBusy()) {
        this.pendingTerminalResult ??= {
          sessionId: this.sessionId,
          status: "aborted",
        };
        this.agent.abort();
        await this.runningTurn?.catch(() => undefined);
      }

      this.finalizing = true;
      this.clearFlushTimer();
      await this.drainEventPipeline();
      await this.store.flush();
      this.stopWatchdog();
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.disposed = true;
      this.finalizing = false;
    })();

    return await this.disposePromise;
  }

  private async runTurnToCompletion(turn: StartTurnInput["turn"]): Promise<void> {
    try {
      await this.agent.prompt(turn.userMessage);
      this.finalizing = true;
      await this.drainEventPipeline();

      if (this.pendingTerminalResult) {
        const interruptStatus =
          this.pendingTerminalResult.status === "aborted"
            ? "aborted"
            : this.pendingTerminalResult.status === "interrupted"
              ? "interrupted"
              : "error";

        await this.store.interruptRun({
          lastError: this.pendingTerminalResult.lastError,
          status: interruptStatus,
          turnId: turn.turnId,
        });
        this.latestResult = this.pendingTerminalResult;
      } else {
        await this.store.completeRun({ turnId: turn.turnId });
        this.latestResult = {
          sessionId: this.sessionId,
          status: "completed",
        };
      }

      await this.store.flush();
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error));
      this.finalizing = true;
      await this.drainEventPipeline();
      const interruptStatus =
        this.pendingTerminalResult?.status === "aborted"
          ? "aborted"
          : this.pendingTerminalResult?.status === "interrupted"
            ? "interrupted"
            : "error";
      await this.store.interruptRun({
        lastError: this.pendingTerminalResult?.lastError ?? nextError.message,
        status: interruptStatus,
        turnId: turn.turnId,
      });
      await this.store.flush();
      this.latestResult = {
        lastError: this.pendingTerminalResult?.lastError ?? nextError.message,
        sessionId: this.sessionId,
        status: interruptStatus,
      };
    } finally {
      this.promptPending = false;
      this.pendingTerminalResult = undefined;
      this.stopWatchdog();
      this.finalizing = false;
    }
  }

  private enqueueEvent(event: AgentEvent): void {
    const run = this.eventQueue.then(async () => {
      if (this.disposed) {
        return;
      }

      await this.handleEvent(event);
    });

    this.eventQueue = run.then(
      () => undefined,
      async (error) => {
        const nextError = error instanceof Error ? error : new Error(String(error));
        this.pendingTerminalResult = {
          lastError: nextError.message,
          sessionId: this.sessionId,
          status: "error",
        };
        await this.store.applyEnvelope({
          error: nextError,
          kind: "runtime-error",
          sessionId: this.sessionId,
        });
        this.agent.abort();
      },
    );
  }

  private async handleEvent(event: AgentEvent): Promise<void> {
    if (!this.isTurnOpenForEvents()) {
      return;
    }

    this.markProgress();

    switch (event.type) {
      case "agent_start":
      case "turn_start":
      case "turn_end":
      case "tool_execution_end":
      case "tool_execution_start":
      case "tool_execution_update":
        await this.store.applyEnvelope({
          kind: "progress",
          sessionId: this.sessionId,
          turnId: this.store.runtime?.turnId ?? "",
        });
        return;
      case "message_start": {
        const draft = normalizeAssistantDraft(event.message);

        if (draft) {
          this.queueAssistantStream(draft, this.store.runtime?.turnId ?? "");
        }
        return;
      }
      case "message_update": {
        const draft = normalizeAssistantDraft(event.message);

        if (draft) {
          this.queueAssistantStream(draft, this.store.runtime?.turnId ?? "");
        }
        return;
      }
      case "message_end": {
        if (event.message.role === "user") {
          return;
        }

        if (event.message.role === "assistant") {
          const draft = normalizeAssistantDraft(event.message);

          if (!draft) {
            return;
          }

          if (draft.stopReason === "aborted" || draft.stopReason === "error") {
            await this.flushPendingAssistantStream();
            await this.store.applyEnvelope({
              kind: "assistant-stream",
              message: draft,
              sessionId: this.sessionId,
              turnId: this.store.runtime?.turnId ?? "",
            });
            return;
          }

          await this.flushPendingAssistantStream();
          await this.store.applyEnvelope({
            kind: "message-end",
            message: draft,
            sessionId: this.sessionId,
            turnId: this.store.runtime?.turnId ?? "",
          });
          return;
        }

        const [toolResult] = normalizeMessages([event.message]).filter(
          (message): message is ToolResultMessage => message.role === "toolResult",
        );

        if (!toolResult) {
          return;
        }

        await this.store.applyEnvelope({
          kind: "message-end",
          message: toolResult,
          sessionId: this.sessionId,
          turnId: this.store.runtime?.turnId ?? "",
        });
        return;
      }
    }
  }

  private queueAssistantStream(message: AssistantMessage, turnId: string): void {
    this.pendingAssistantStream = {
      message,
      turnId,
    };

    if (this.finalizing || this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flushPendingAssistantStream();
    }, STREAM_FLUSH_MS);
  }

  private async flushPendingAssistantStream(): Promise<void> {
    this.clearFlushTimer();

    if (!this.pendingAssistantStream) {
      return;
    }

    const pending = this.pendingAssistantStream;
    this.pendingAssistantStream = undefined;
    await this.store.applyEnvelope({
      kind: "assistant-stream",
      message: pending.message,
      sessionId: this.sessionId,
      turnId: pending.turnId,
    });
  }

  private async flushEventQueue(): Promise<void> {
    await this.eventQueue;
  }

  private async drainEventPipeline(): Promise<void> {
    while (true) {
      await this.flushEventQueue();

      if (!this.pendingAssistantStream && !this.flushTimer) {
        break;
      }

      await this.flushPendingAssistantStream();
    }

    await this.store.flush();
  }

  private markProgress(): void {
    this.lastProgressAt = Date.now();
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.markProgress();
    this.watchdogInterval = setInterval(() => {
      if (this.disposed || !this.isBusy()) {
        this.stopWatchdog();
        return;
      }

      if (Date.now() - this.lastProgressAt < TURN_IDLE_TIMEOUT_MS) {
        return;
      }

      const nextError = new Error("Runtime timed out after no progress.");
      this.pendingTerminalResult = {
        lastError: nextError.message,
        sessionId: this.sessionId,
        status: "error",
      };
      this.agent.abort();
      this.stopWatchdog();
    }, TURN_IDLE_POLL_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = undefined;
    }
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) {
      return;
    }

    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }

  private getAgentTools(runtime = this.repoRuntime): AgentTool[] {
    if (!runtime) {
      return [];
    }

    return createRepoTools(runtime, {
      onRepoError: async (error) => {
        const nextError = error instanceof Error ? error : new Error(String(error));
        await this.store.applyEnvelope({
          error: nextError,
          kind: "runtime-error",
          sessionId: this.sessionId,
        });

        if (shouldStopStreamingForRuntimeError(nextError)) {
          this.pendingTerminalResult = {
            lastError: nextError.message,
            sessionId: this.sessionId,
            status: "error",
          };
          this.agent.abort();
        }
      },
    }).agentTools;
  }

  private isTurnOpenForEvents(): boolean {
    return this.store.runtime?.phase === "running";
  }
}

async function loadSessionSeed(params: {
  fallbackSession?: SessionData;
  sessionId: string;
}): Promise<SessionWorkerSeed | undefined> {
  const loaded = await loadSessionWithMessages(params.sessionId);

  if (!loaded) {
    if (!params.fallbackSession) {
      return undefined;
    }

    return {
      runtime: undefined,
      session: params.fallbackSession,
      transcriptMessages: [],
    };
  }

  return {
    runtime: loaded.runtime,
    session: loaded.session,
    transcriptMessages: loaded.messages,
  };
}

async function persistSessionSettings(
  store: TurnEventStore,
  updates: Partial<Pick<SessionData, "model" | "provider" | "providerGroup" | "thinkingLevel">>,
): Promise<void> {
  const nextSession = buildPersistedSession(
    {
      ...store.session,
      ...updates,
      error: undefined,
      updatedAt: getIsoNow(),
    },
    store.transcriptMessages,
  );

  await putSession(nextSession);
  store.session = nextSession;
}

export class SessionWorkerCoordinator {
  private readonly runner: WorkerAgentRunner;
  private opQueue = Promise.resolve();
  private pendingOperations = 0;
  private disposed = false;
  private disposePromise?: Promise<void>;

  private constructor(seed: SessionWorkerSeed) {
    this.runner = new WorkerAgentRunner(
      new TurnEventStore({
        runtime: seed.runtime,
        session: seed.session,
        transcriptMessages: seed.transcriptMessages,
      }),
    );
  }

  static async load(params: {
    sessionId: string;
    fallbackSession?: SessionData;
  }): Promise<SessionWorkerCoordinator | undefined> {
    const seed = await loadSessionSeed({
      fallbackSession: params.fallbackSession,
      sessionId: params.sessionId,
    });

    if (!seed) {
      return undefined;
    }

    return new SessionWorkerCoordinator(seed);
  }

  isIdle(): boolean {
    return this.pendingOperations === 0 && !this.runner.isBusy();
  }

  async startTurn(input: StartTurnInput): Promise<void> {
    if (this.disposed) {
      return;
    }

    await this.run(async () => {
      if (this.disposed) {
        return;
      }

      await this.runner.startTurn(input);
    });
  }

  async waitForTurn(): Promise<TurnCompletionResult | undefined> {
    return await this.runner.waitForTurn();
  }

  async abortTurn(): Promise<void> {
    if (this.disposed) {
      return;
    }

    await this.run(async () => {
      if (this.disposed) {
        return;
      }

      this.runner.abort();
    });
  }

  async appendSessionNotice(error: Error): Promise<void> {
    if (this.disposed) {
      return;
    }

    await this.run(async () => {
      if (this.disposed) {
        return;
      }

      await this.runner.store.applyEnvelope({
        error,
        kind: "runtime-error",
        sessionId: this.runner.store.session.id,
      });
      await this.runner.store.flush();
    });
  }

  async reconcileInterruptedSession(_input?: ReconcileInterruptedSessionInput): Promise<void> {
    if (this.disposed) {
      return;
    }

    await this.run(async () => {
      if (this.disposed || this.runner.store.runtime?.phase !== "running") {
        return;
      }

      const interruption = new StreamInterruptedRuntimeError();
      await this.runner.store.interruptRun({
        lastError: interruption.message,
        status: "interrupted",
        turnId: this.runner.store.runtime.turnId,
      });
      await this.runner.store.applyEnvelope({
        error: interruption,
        kind: "runtime-error",
        sessionId: this.runner.store.session.id,
      });
      await this.runner.store.flush();
    });
  }

  async setModelSelection(input: ConfigureSessionInput): Promise<void> {
    if (this.disposed) {
      return;
    }

    await this.run(async () => {
      if (this.disposed) {
        return;
      }

      await this.runner.setModelSelection(input.providerGroup, input.modelId);
    });
  }

  async setThinkingLevel(input: SetThinkingLevelInput): Promise<void> {
    if (this.disposed) {
      return;
    }

    await this.run(async () => {
      if (this.disposed) {
        return;
      }

      await this.runner.setThinkingLevel(input.thinkingLevel);
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (this.disposePromise) {
      return await this.disposePromise;
    }

    this.disposePromise = this.run(async () => {
      if (this.disposed) {
        return;
      }

      this.disposed = true;
      await this.runner.dispose();
    });

    return await this.disposePromise;
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    this.pendingOperations += 1;
    const next = this.opQueue.then(operation);
    this.opQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next.finally(() => {
      this.pendingOperations -= 1;
    });
  }
}

export type SessionWorkerCoordinatorAppendNoticeInput = AppendSessionNoticeInput;
