import { db, putSessionRuntime, runConversationTransaction } from "@gitinspect/db/schema";
import { normalizeSessionRuntime } from "@gitinspect/db/session-runtime";
import { toMessageRow } from "@gitinspect/pi/agent/session-adapter";
import { buildSystemMessage, classifyRuntimeError } from "@gitinspect/pi/agent/runtime-errors";
import { getIsoNow } from "@gitinspect/pi/lib/dates";
import { createId } from "@gitinspect/pi/lib/ids";
import { buildPersistedSession } from "@gitinspect/pi/sessions/session-service";
import type { MessageRow, SessionData, SessionRuntimeRow } from "@gitinspect/db/storage-types";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@gitinspect/pi/types/chat";

export type TurnEnvelope = {
  turnId: string;
  userMessage: UserMessage;
};

export type BeginTurnInput = {
  ownerTabId: string;
  turn: TurnEnvelope;
};

export type TurnEventEnvelope =
  | {
      kind: "assistant-stream";
      message: AssistantMessage;
      sessionId: string;
      turnId: string;
    }
  | {
      kind: "message-end";
      message: AssistantMessage | ToolResultMessage;
      sessionId: string;
      turnId: string;
    }
  | {
      kind: "progress";
      sessionId: string;
      turnId: string;
    }
  | {
      error: Error;
      kind: "runtime-error";
      sessionId: string;
    };

function nextOrder(messages: readonly MessageRow[]): number {
  return messages.reduce((max, message) => Math.max(max, message.order), -1) + 1;
}

function buildQueuedSession(
  session: SessionData,
  transcriptMessages: readonly MessageRow[],
  isStreaming: boolean,
  updatedAt: string,
): SessionData {
  return buildPersistedSession(
    {
      ...session,
      error: undefined,
      isStreaming,
      updatedAt,
    },
    [...transcriptMessages],
  );
}

export class TurnEventStore {
  session: SessionData;
  runtime?: SessionRuntimeRow;
  transcriptMessages: MessageRow[];

  private queue = Promise.resolve();
  private currentOrder: number;

  constructor(seed: {
    runtime?: SessionRuntimeRow;
    session: SessionData;
    transcriptMessages: MessageRow[];
  }) {
    this.session = seed.session;
    this.runtime = normalizeSessionRuntime(seed.session.id, seed.runtime);
    this.transcriptMessages = [...seed.transcriptMessages].sort(
      (left, right) => left.order - right.order,
    );
    this.currentOrder = nextOrder(this.transcriptMessages);
  }

  beginTurn(input: BeginTurnInput): Promise<void> {
    return this.enqueue(async () => {
      const now = getIsoNow();
      const previousRuntime = this.runtime;
      const runtime: SessionRuntimeRow = {
        ...previousRuntime,
        lastError: undefined,
        lastProgressAt: now,
        lastTerminalStatus: undefined,
        ownerTabId: input.ownerTabId,
        pendingToolCallOwners: {},
        phase: "running",
        sessionId: this.session.id,
        startedAt: now,
        status: "streaming",
        streamMessage: undefined,
        turnId: input.turn.turnId,
        updatedAt: now,
      };
      const userRow = toMessageRow(
        this.session.id,
        input.turn.userMessage,
        undefined,
        input.turn.userMessage.id,
        this.currentOrder,
      );
      const transcriptMessages = [...this.transcriptMessages, userRow];
      const session = buildQueuedSession(this.session, transcriptMessages, true, now);

      await runConversationTransaction(async () => {
        const existingSession = await db.sessions.get(this.session.id);

        if (!existingSession) {
          await db.sessions.put(this.session);
        }

        await db.messages.put(userRow);
        await db.sessions.put(session);
        await db.sessionRuntime.put(runtime);
      });

      this.currentOrder += 1;
      this.runtime = runtime;
      this.session = session;
      this.transcriptMessages = transcriptMessages;
    });
  }

  applyEnvelope(envelope: TurnEventEnvelope): Promise<void> {
    switch (envelope.kind) {
      case "assistant-stream":
        return this.enqueue(async () => {
          const now = getIsoNow();
          const runtime: SessionRuntimeRow = {
            ...this.runtime,
            lastProgressAt: now,
            ownerTabId: this.runtime?.ownerTabId,
            pendingToolCallOwners: this.runtime?.pendingToolCallOwners ?? {},
            phase: "running",
            sessionId: this.session.id,
            status: "streaming",
            streamMessage: envelope.message,
            turnId: envelope.turnId,
            updatedAt: now,
          };

          await putSessionRuntime(runtime);
          this.runtime = runtime;
        });
      case "message-end":
        return envelope.message.role === "assistant"
          ? this.appendAssistantMessage(envelope.message, envelope.turnId)
          : this.appendToolResultMessage(envelope.message, envelope.turnId);
      case "progress":
        return this.enqueue(async () => {
          if (!this.runtime) {
            return;
          }

          const now = getIsoNow();
          const runtime: SessionRuntimeRow = {
            ...this.runtime,
            lastProgressAt: now,
            sessionId: this.session.id,
            turnId: envelope.turnId,
            updatedAt: now,
          };

          await putSessionRuntime(runtime);
          this.runtime = runtime;
        });
      case "runtime-error":
        return this.appendRuntimeError(envelope.error);
    }
  }

  completeRun(params?: { turnId?: string }): Promise<void> {
    return this.enqueue(async () => {
      const now = getIsoNow();
      const runtime: SessionRuntimeRow = {
        ...this.runtime,
        lastError: undefined,
        lastProgressAt: now,
        lastTerminalStatus: "completed",
        ownerTabId: undefined,
        pendingToolCallOwners: {},
        phase: "idle",
        sessionId: this.session.id,
        status: "completed",
        streamMessage: undefined,
        turnId: params?.turnId,
        updatedAt: now,
      };
      const session = buildQueuedSession(this.session, this.transcriptMessages, false, now);

      await runConversationTransaction(async () => {
        await db.sessions.put(session);
        await db.sessionRuntime.put(runtime);
      });

      this.runtime = runtime;
      this.session = session;
    });
  }

  interruptRun(params: {
    lastError?: string;
    status: "aborted" | "error" | "interrupted";
    turnId?: string;
  }): Promise<void> {
    return this.enqueue(async () => {
      const now = getIsoNow();
      const runtime: SessionRuntimeRow = {
        ...this.runtime,
        lastError: params.lastError,
        lastProgressAt: now,
        lastTerminalStatus: params.status === "interrupted" ? undefined : params.status,
        ownerTabId: undefined,
        pendingToolCallOwners: {},
        phase: "interrupted",
        sessionId: this.session.id,
        status: params.status,
        turnId: params.turnId,
        updatedAt: now,
      };
      const session = buildQueuedSession(this.session, this.transcriptMessages, false, now);

      await runConversationTransaction(async () => {
        await db.sessions.put(session);
        await db.sessionRuntime.put(runtime);
      });

      this.runtime = runtime;
      this.session = session;
    });
  }

  flush(): Promise<void> {
    return this.queue;
  }

  private appendAssistantMessage(message: AssistantMessage, turnId: string): Promise<void> {
    return this.enqueue(async () => {
      const now = getIsoNow();
      const pendingToolCallOwners = {
        ...this.runtime?.pendingToolCallOwners,
      };

      for (const block of message.content) {
        if (block.type === "toolCall") {
          pendingToolCallOwners[block.id] = message.id;
        }
      }

      const assistantRow = toMessageRow(
        this.session.id,
        message,
        undefined,
        message.id,
        this.currentOrder,
      );
      const transcriptMessages = [...this.transcriptMessages, assistantRow];
      const session = buildQueuedSession(this.session, transcriptMessages, true, now);
      const runtime: SessionRuntimeRow = {
        ...this.runtime,
        lastProgressAt: now,
        ownerTabId: this.runtime?.ownerTabId,
        pendingToolCallOwners,
        phase: "running",
        sessionId: this.session.id,
        status: "streaming",
        streamMessage: undefined,
        turnId,
        updatedAt: now,
      };

      await runConversationTransaction(async () => {
        await db.messages.put(assistantRow);
        await db.sessions.put(session);
        await db.sessionRuntime.put(runtime);
      });

      this.currentOrder += 1;
      this.runtime = runtime;
      this.session = session;
      this.transcriptMessages = transcriptMessages;
    });
  }

  private appendToolResultMessage(message: ToolResultMessage, turnId: string): Promise<void> {
    return this.enqueue(async () => {
      const now = getIsoNow();
      const pendingToolCallOwners = {
        ...this.runtime?.pendingToolCallOwners,
      };
      const assistantId = pendingToolCallOwners[message.toolCallId];

      if (!assistantId) {
        console.warn("[tool-result-linker] dropped orphan tool result", {
          sessionId: this.session.id,
          toolCallId: message.toolCallId,
        });

        const runtime: SessionRuntimeRow = {
          ...this.runtime,
          lastError: `Dropped orphan tool result ${message.toolCallId}`,
          lastProgressAt: now,
          sessionId: this.session.id,
          updatedAt: now,
        };

        await putSessionRuntime(runtime);
        this.runtime = runtime;
        return;
      }

      delete pendingToolCallOwners[message.toolCallId];

      const linkedMessage: ToolResultMessage = {
        ...message,
        parentAssistantId: assistantId,
      };
      const toolResultRow = toMessageRow(
        this.session.id,
        linkedMessage,
        undefined,
        linkedMessage.id,
        this.currentOrder,
      );
      const transcriptMessages = [...this.transcriptMessages, toolResultRow];
      const session = buildQueuedSession(this.session, transcriptMessages, true, now);
      const runtime: SessionRuntimeRow = {
        ...this.runtime,
        lastProgressAt: now,
        ownerTabId: this.runtime?.ownerTabId,
        pendingToolCallOwners,
        phase: "running",
        sessionId: this.session.id,
        status: "streaming",
        turnId,
        updatedAt: now,
      };

      await runConversationTransaction(async () => {
        await db.messages.put(toolResultRow);
        await db.sessions.put(session);
        await db.sessionRuntime.put(runtime);
      });

      this.currentOrder += 1;
      this.runtime = runtime;
      this.session = session;
      this.transcriptMessages = transcriptMessages;
    });
  }

  private appendRuntimeError(error: Error): Promise<void> {
    return this.enqueue(async () => {
      const classified = classifyRuntimeError(error);

      if (
        this.transcriptMessages.some(
          (message) => message.role === "system" && message.fingerprint === classified.fingerprint,
        )
      ) {
        return;
      }

      const now = getIsoNow();
      const notice = toMessageRow(
        this.session.id,
        buildSystemMessage(classified, createId(), Date.now()),
        undefined,
        undefined,
        this.currentOrder,
      );
      const transcriptMessages = [...this.transcriptMessages, notice];
      const session = buildQueuedSession(
        this.session,
        transcriptMessages,
        this.runtime?.phase === "running",
        now,
      );

      await runConversationTransaction(async () => {
        await db.messages.put(notice);
        await db.sessions.put(session);
      });

      this.currentOrder += 1;
      this.session = session;
      this.transcriptMessages = transcriptMessages;
    });
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
