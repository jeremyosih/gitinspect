import { Cause, Effect, Exit, Fiber, Layer, ManagedRuntime, Semaphore, Stream } from "effect";
import * as Pi from "effect-pi-durable";
import type { AssistantMessage as PiAssistantMessage } from "@earendil-works/pi-ai";
import { BusyRuntimeError, StreamInterruptedRuntimeError } from "./runtime-command-errors";
import { TurnEventStore } from "./turn-event-store";
import type {
  AppendSessionNoticeInput,
  ConfigureSessionInput,
  ReconcileInterruptedSessionInput,
  SetThinkingLevelInput,
  StartTurnInput,
  TurnCompletionResult,
} from "./runtime-worker-types";
import { shouldStopStreamingForRuntimeError } from "./runtime-errors";
import { ProviderModels } from "./provider-models";
import { SYSTEM_PROMPT } from "./system-prompt";
import {
  assistantMessageOf,
  hasVisibleContent,
  seedTranscript,
  toolResultMessageOf,
} from "./transcript-entries";
import { resolveProviderAuthForProvider } from "../auth/resolve-api-key";
import { putSession } from "@gitinspect/db";
import { getIsoNow } from "../lib/dates";
import { createId } from "../lib/ids";
import { getCanonicalProvider, getModel } from "../models/catalog";
import {
  createOptionalRepoRuntime,
  repoSnapshotIdentity,
  retainRepoSnapshot,
} from "../repo/repo-runtime";
import { loadSessionWithMessages, buildPersistedSession } from "../sessions/session-service";
import { RepoTools, RepoWorkspace } from "../tools/index";
import type { AssistantMessage } from "../types/chat";
import type { ModelDefinition } from "../types/models";
import type { MessageRow, SessionData, SessionRuntimeRow } from "@gitinspect/db";

type SessionWorkerSeed = {
  runtime?: SessionRuntimeRow;
  session: SessionData;
  transcriptMessages: MessageRow[];
};
const TURN_IDLE_TIMEOUT_MS = 15 * 60_000;

/** The agent's standing instructions, sent as the system prompt exactly as written. */
const Instructions = Pi.Extension.make({
  name: "gitinspect",
  sections: [Pi.Section.make("gitinspect", () => Effect.succeed(SYSTEM_PROMPT), { tag: false })],
});

const Infrastructure = Layer.mergeAll(Pi.Storage.memory, ProviderModels, Pi.ExecutionEnv.none);

const settings = {
  // Browsers cannot send the headers the Codex WebSocket transport needs.
  stream: { transport: "sse" },
  // Repository tools share one shell working directory.
  toolExecution: "sequential",
} as const;

/**
 * One Pi harness per session. Its storage is memory: the persisted transcript is the durable
 * state, and a new harness starts its conversation from it.
 */
function makeAgentRuntime(workspace: RepoWorkspace["Service"] | undefined) {
  return ManagedRuntime.make(
    workspace
      ? Pi.Harness.layer({ extensions: [Instructions, RepoTools], settings }).pipe(
          Layer.provide(Layer.succeed(RepoWorkspace, workspace)),
          Layer.provide(Infrastructure),
        )
      : Pi.Harness.layer({ extensions: [Instructions], settings }).pipe(
          Layer.provide(Infrastructure),
        ),
  );
}

type LiveGeneration = { generation?: { message?: PiAssistantMessage } };

/** Writes what Pi commits during a turn into the transcript: the streaming answer and each finished message. */
class TranscriptSync {
  private draft?: AssistantMessage;
  private draftId?: string;

  constructor(
    private readonly store: TurnEventStore,
    private lastEntryId: number,
  ) {}

  apply(entries: readonly Pi.EntryRecord[], partial?: PiAssistantMessage): Promise<void> {
    const sessionId = this.store.session.id;
    const turnId = this.store.runtime!.turnId!;
    let written = Promise.resolve();

    for (const entry of entries) {
      if (entry.id <= this.lastEntryId) continue;
      this.lastEntryId = entry.id;
      const message = entry.model?.[0];

      if (message?.role === "toolResult") {
        written = this.store.applyEnvelope({
          kind: "message-end",
          message: toolResultMessageOf(message, createId()),
          sessionId,
          turnId,
        });
      } else if (message?.role === "assistant") {
        const ended = message.stopReason === "aborted" || message.stopReason === "error";

        if (ended) {
          // An unfinished answer stays the turn's draft rather than joining the transcript.
          if (hasVisibleContent(message)) written = this.stream(message);
          continue;
        }

        written = this.store.applyEnvelope({
          kind: "message-end",
          message: assistantMessageOf(message, (this.draftId ??= createId())),
          sessionId,
          turnId,
        });
        this.draft = undefined;
        this.draftId = undefined;
      }
    }

    return partial && hasVisibleContent(partial) ? this.stream(partial) : written;
  }

  /** Keep the unfinished answer visible, marked with how the turn ended. */
  interrupt(stopReason: "aborted" | "error", errorMessage: string): Promise<void> {
    if (!this.draft) return Promise.resolve();

    return this.store.applyEnvelope({
      kind: "assistant-stream",
      message: { ...this.draft, errorMessage, stopReason },
      sessionId: this.store.session.id,
      turnId: this.store.runtime!.turnId!,
    });
  }

  private stream(message: PiAssistantMessage): Promise<void> {
    this.draft = assistantMessageOf(message, (this.draftId ??= createId()));

    return this.store.applyEnvelope({
      kind: "assistant-stream",
      message: this.draft,
      sessionId: this.store.session.id,
      turnId: this.store.runtime!.turnId!,
    });
  }
}

function lastEntryId(entries: readonly Pi.EntryRecord[]): number {
  return entries.reduce((last, entry) => Math.max(last, entry.id), 0);
}

function unansweredError(receipt: Pi.SettledSubmissionRecord): Error {
  if (receipt.status !== "unanswered") return new Error("Turn ended without an answer.");

  return receipt.reason === "aborted"
    ? new DOMException("Turn cancelled", "AbortError")
    : new Error(
        typeof receipt.detail === "string"
          ? receipt.detail
          : `Turn ended without an answer: ${receipt.reason}`,
      );
}

class WorkerAgentRunner {
  readonly store: TurnEventStore;
  private disposed = false;
  private runningTurn?: Promise<void>;
  private agent?: ReturnType<typeof makeAgentRuntime>;
  private conversation?: Pi.Conversation;
  private sync?: TranscriptSync;
  private aborted = false;
  private repoRuntime;
  private latestResult?: TurnCompletionResult;
  private terminalError?: Error;
  private watchdog?: ReturnType<typeof setTimeout>;
  constructor(store: TurnEventStore) {
    this.store = store;
    const source = store.session.repoSource;
    const pinned = store.runtime?.repoSnapshot;
    // Keep reading the commit earlier turns read, across worker restarts.
    this.repoRuntime = createOptionalRepoRuntime(
      source && pinned?.identity === repoSnapshotIdentity(source)
        ? { ...source, resolvedRef: { kind: "commit", sha: pinned.sha } }
        : source,
    );
  }
  isBusy(): boolean {
    return this.runningTurn !== undefined;
  }
  async startTurn(input: StartTurnInput): Promise<void> {
    if (this.disposed) return;
    if (this.isBusy()) throw new BusyRuntimeError(this.store.session.id);
    this.latestResult = undefined;
    this.terminalError = undefined;
    this.sync = undefined;
    this.aborted = false;
    const previousMessages = [...this.store.transcriptMessages];
    await this.store.beginTurn({ ownerTabId: input.ownerTabId, turn: input.turn });
    this.runningTurn = this.runTurn(input, previousMessages).finally(() => {
      this.runningTurn = undefined;
      this.clearWatchdog();
    });
  }
  async waitForTurn(): Promise<TurnCompletionResult | undefined> {
    await this.runningTurn;
    return this.latestResult;
  }
  abort(): void {
    this.aborted = true;
    if (this.agent && this.conversation)
      this.agent.runFork(this.conversation.abort().pipe(Effect.ignore));
  }
  async setModelSelection(
    group: ConfigureSessionInput["providerGroup"],
    modelId: string,
  ): Promise<void> {
    if (this.isBusy()) throw new BusyRuntimeError(this.store.session.id);
    const provider = getCanonicalProvider(group);
    getModel(provider, modelId);
    await persistSessionSettings(this.store, { providerGroup: group, provider, model: modelId });
  }
  async setThinkingLevel(thinkingLevel: SetThinkingLevelInput["thinkingLevel"]): Promise<void> {
    if (this.isBusy()) throw new BusyRuntimeError(this.store.session.id);
    await persistSessionSettings(this.store, { thinkingLevel });
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.abort();
    await this.runningTurn;
    await this.store.flush();
    await this.closeAgent();
  }
  private async closeAgent(): Promise<void> {
    const agent = this.agent;
    this.agent = undefined;
    this.conversation = undefined;
    await agent?.dispose();
  }
  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = undefined;
  }
  private progress(): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      this.terminalError = new Error("Runtime timed out after no progress.");
      this.abort();
    }, TURN_IDLE_TIMEOUT_MS);
  }
  private workspace(): RepoWorkspace["Service"] | undefined {
    const runtime = this.repoRuntime;

    return (
      runtime && {
        runtime,
        onRepoError: async (error) => {
          const next = error instanceof Error ? error : new Error(String(error));
          await this.catchUp();
          await this.store.applyEnvelope({
            kind: "runtime-error",
            error: next,
            sessionId: this.store.session.id,
          });
          if (shouldStopStreamingForRuntimeError(next)) {
            this.terminalError = next;
            this.abort();
          }
        },
      }
    );
  }
  /** Write what Pi has committed so far, so a notice follows the message whose tool raised it. */
  private async catchUp(): Promise<void> {
    const { agent, conversation, sync } = this;
    if (!agent || !conversation || !sync) return;
    const exit = await agent.runPromiseExit(conversation.context());
    if (Exit.isSuccess(exit)) await sync.apply(exit.value.entries);
  }
  /** Submit the turn's input and mirror Pi's commits into the transcript until it settles. */
  private turn(input: StartTurnInput, previousMessages: MessageRow[], model: ModelDefinition) {
    return Effect.gen({ self: this }, function* () {
      const harness = yield* Pi.Harness;
      const conversation = (this.conversation ??= yield* harness.root({
        init: seedTranscript(previousMessages),
      }));
      yield* conversation.configure({
        model: { provider: model.provider, modelId: model.id },
        thinkingLevel: this.store.session.thinkingLevel,
      });
      const sync = (this.sync = new TranscriptSync(
        this.store,
        lastEntryId((yield* conversation.context()).entries),
      ));
      const watcher = yield* conversation.views.pipe(
        Stream.runForEach((view) => {
          this.progress();
          const live: LiveGeneration | undefined = view.docs["pi.live"];

          return Effect.promise(() => sync.apply(view.entries, live?.generation?.message));
        }),
        Effect.forkChild,
      );
      const submission = yield* conversation.submit({
        type: "input",
        content: structuredClone(input.turn.userMessage.content),
        requestId: input.turn.turnId,
      });
      // An abort that arrived before the submission existed had nothing to stop.
      if (this.aborted) yield* conversation.abort();
      const receipt = yield* submission.wait;
      yield* Fiber.interrupt(watcher);
      const settled = yield* conversation.context();
      yield* Effect.promise(() => sync.apply(settled.entries));

      return receipt;
    });
  }
  private async runTurn(input: StartTurnInput, previousMessages: MessageRow[]): Promise<void> {
    let completed = false;
    try {
      this.progress();
      const session = this.store.session;
      const model = getModel(session.provider, session.model);
      const auth = await resolveProviderAuthForProvider(session.provider, session.providerGroup);
      if (!auth) throw new Error(`No credentials stored for ${session.provider}`);
      const agent = (this.agent ??= makeAgentRuntime(this.workspace()));
      const exit = await agent.runPromiseExit(this.turn(input, previousMessages, model));
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      if (this.terminalError || exit.value.status !== "done")
        throw this.terminalError ?? unansweredError(exit.value);
      const runtime = this.repoRuntime;
      await this.store.completeRun({
        turnId: input.turn.turnId,
        repoSnapshot: runtime && {
          identity: repoSnapshotIdentity(session.repoSource ?? runtime.source),
          sha: await retainRepoSnapshot(runtime),
        },
      });
      completed = true;
    } catch (error) {
      const next =
        this.terminalError ?? (error instanceof Error ? error : new Error(String(error)));
      const aborted = this.aborted && !this.terminalError;
      await this.sync?.interrupt(aborted ? "aborted" : "error", next.message);
      await this.store.interruptRun({
        status: aborted ? "aborted" : "error",
        lastError: aborted ? undefined : next.message,
        turnId: input.turn.turnId,
      });
      if (!aborted)
        await this.store.applyEnvelope({
          kind: "runtime-error",
          error: next,
          sessionId: this.store.session.id,
        });
      this.latestResult = {
        sessionId: this.store.session.id,
        status: aborted ? "aborted" : "error",
        lastError: aborted ? undefined : next.message,
      };
      // The transcript no longer matches Pi's conversation; the next turn starts a new one from it.
      await this.closeAgent();
    } finally {
      await this.store.flush();
      if (completed) this.latestResult = { sessionId: this.store.session.id, status: "completed" };
    }
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
  private readonly operations = Semaphore.makeUnsafe(1);
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
    const next = Effect.runPromise(Effect.promise(operation).pipe(this.operations.withPermit));
    return next.finally(() => {
      this.pendingOperations -= 1;
    });
  }
}

export type SessionWorkerCoordinatorAppendNoticeInput = AppendSessionNoticeInput;
