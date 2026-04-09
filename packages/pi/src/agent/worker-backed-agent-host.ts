import { BusyRuntimeError } from "@gitinspect/pi/agent/runtime-command-errors";
import { getCurrentTabId } from "@gitinspect/pi/agent/tab-id";
import { getRuntimeWorker } from "@gitinspect/pi/agent/runtime-worker-client";
import type { SessionRunner } from "@gitinspect/pi/agent/session-runner";
import type { TurnEnvelope } from "@gitinspect/pi/agent/turn-event-store";
import { createId } from "@gitinspect/pi/lib/ids";
import { getCanonicalProvider } from "@gitinspect/pi/models/catalog";
import type { SessionData } from "@gitinspect/db";
import type { ProviderGroupId, ThinkingLevel } from "@gitinspect/pi/types/models";

type HostState = "idle" | "starting" | "running" | "disposing" | "disposed";

function createTurn(content: string): TurnEnvelope {
  return {
    turnId: createId(),
    userMessage: {
      content,
      id: createId(),
      role: "user",
      timestamp: Date.now(),
    },
  };
}

export class WorkerBackedAgentHost implements SessionRunner {
  private readonly worker = getRuntimeWorker();
  private runningTurn?: Promise<void>;
  private disposePromise?: Promise<void>;
  private state: HostState = "idle";
  private startSequence = 0;

  constructor(private session: SessionData) {}

  isBusy(): boolean {
    return this.state === "starting" || this.state === "running" || this.runningTurn !== undefined;
  }

  async startTurn(content: string): Promise<void> {
    const trimmed = content.trim();

    if (!trimmed || this.state === "disposing" || this.state === "disposed") {
      return;
    }

    if (this.state !== "idle") {
      throw new BusyRuntimeError(this.session.id);
    }

    this.state = "starting";
    const startSequence = ++this.startSequence;
    const turn = createTurn(trimmed);
    let waitForTurnPromise: Promise<void> | undefined;

    try {
      await this.worker.startTurn({
        ownerTabId: getCurrentTabId(),
        session: this.session,
        turn,
      });

      waitForTurnPromise = this.worker
        .waitForTurn(this.session.id)
        .then(() => undefined)
        .finally(() => {
          if (this.runningTurn === waitForTurnPromise) {
            this.runningTurn = undefined;
          }

          if (this.state === "running") {
            this.state = "idle";
          }
        });
      this.runningTurn = waitForTurnPromise;

      if (!this.isStartActive(startSequence)) {
        if (this.shouldAbortAfterCancelledStart()) {
          await this.worker.abortTurn(this.session.id);
        }

        await waitForTurnPromise.catch(() => undefined);
        return;
      }

      this.state = "running";
    } finally {
      if (this.state === "starting" && this.startSequence === startSequence) {
        this.state = "idle";
      }
    }
  }

  async waitForTurn(): Promise<void> {
    await this.runningTurn;
  }

  async abort(): Promise<void> {
    if (this.state !== "running") {
      return;
    }

    await this.worker.abortTurn(this.session.id);
  }

  async setModelSelection(providerGroup: ProviderGroupId, modelId: string): Promise<void> {
    if (this.state === "disposing" || this.state === "disposed") {
      return;
    }

    await this.worker.setModelSelection({
      modelId,
      providerGroup,
      sessionId: this.session.id,
    });
    this.session = {
      ...this.session,
      model: modelId,
      provider: getCanonicalProvider(providerGroup),
      providerGroup,
    };
  }

  async setThinkingLevel(thinkingLevel: ThinkingLevel): Promise<void> {
    if (this.state === "disposing" || this.state === "disposed") {
      return;
    }

    await this.worker.setThinkingLevel({
      sessionId: this.session.id,
      thinkingLevel,
    });
    this.session = {
      ...this.session,
      thinkingLevel,
    };
  }

  async dispose(): Promise<void> {
    if (this.state === "disposed") {
      return;
    }

    if (this.disposePromise) {
      return await this.disposePromise;
    }

    this.state = "disposing";
    this.disposePromise = (async () => {
      await this.worker.disposeSession(this.session.id);
      await this.runningTurn?.catch(() => undefined);
      this.runningTurn = undefined;
      this.state = "disposed";
    })();

    return await this.disposePromise;
  }

  private isStartActive(startSequence: number): boolean {
    return this.state === "starting" && this.startSequence === startSequence;
  }

  private shouldAbortAfterCancelledStart(): boolean {
    return this.state !== "disposing" && this.state !== "disposed";
  }
}
