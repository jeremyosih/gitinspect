import * as Effect from "effect/Effect";
import * as Pi from "effect-pi-durable";
import type {
  AssistantMessage as PiAssistantMessage,
  ToolResultMessage as PiToolResultMessage,
} from "@earendil-works/pi-ai";
import type { MessageRow } from "@gitinspect/db";
import type { AssistantMessage, StopReason, ToolResultMessage } from "../types/chat";

/** Detached JSON: stored rows carry `undefined` fields and entries are frozen. */
function plain<A>(value: A): A {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as A);
}

function assistantModel(row: Extract<MessageRow, { role: "assistant" }>): PiAssistantMessage {
  // SAFETY: Assistant rows are Pi AI assistant messages plus the row's bookkeeping; rows written by older engines have the same fields.
  return plain({
    role: "assistant",
    content: row.content,
    api: row.api,
    provider: row.provider,
    model: row.model,
    responseId: row.responseId,
    usage: row.usage,
    stopReason: row.stopReason,
    errorMessage: row.errorMessage,
    timestamp: row.timestamp,
  }) as PiAssistantMessage;
}

function toolResultModel(row: Extract<MessageRow, { role: "toolResult" }>): PiToolResultMessage {
  return plain({
    role: "toolResult",
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    content: row.content,
    // SAFETY: Details were read back from IndexedDB, which stores them as structured JSON.
    details: row.details as PiToolResultMessage["details"],
    isError: row.isError,
    timestamp: row.timestamp,
  });
}

/**
 * The persisted transcript is the session's durable state. A new Pi conversation starts from it,
 * so the model reads the earlier turns as the messages they were. Local notices stay local.
 */
export function seedTranscript(rows: readonly MessageRow[]) {
  return (tx: Pi.Transaction, conversationId: Pi.ConversationId) =>
    Effect.forEach(
      rows,
      (row): Effect.Effect<unknown, Pi.RuntimeError> => {
        switch (row.role) {
          case "user":
            return tx.appendEntry(Pi.UserEntry, conversationId, {
              model: [{ role: "user", content: plain(row.content), timestamp: row.timestamp }],
            });
          case "assistant":
            return tx.appendEntry(Pi.AssistantEntry, conversationId, {
              model: [assistantModel(row)],
            });
          case "toolResult":
            return tx.appendEntry(Pi.ToolResultEntry, conversationId, {
              model: [toolResultModel(row)],
              data: { diagnostics: [] },
            });
          case "system":
            return Effect.void;
        }
      },
      { discard: true },
    );
}

function stopReasonOf(message: PiAssistantMessage): StopReason {
  switch (message.stopReason) {
    case "length":
    case "toolUse":
    case "error":
    case "aborted":
      return message.stopReason;
    default:
      return "stop";
  }
}

/** A Pi assistant message, finished or still streaming, as a transcript message. */
export function assistantMessageOf(message: PiAssistantMessage, id: string): AssistantMessage {
  const { usage } = message;

  return plain({
    id,
    role: "assistant",
    // SAFETY: Pi AI content blocks are the transcript's content blocks.
    content: message.content as AssistantMessage["content"],
    api: message.api,
    provider: message.provider,
    model: message.model,
    responseId: message.responseId,
    usage: {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      totalTokens: usage.totalTokens,
      cost: { ...usage.cost },
    },
    stopReason: stopReasonOf(message),
    errorMessage: message.errorMessage,
    timestamp: message.timestamp,
  });
}

export function toolResultMessageOf(message: PiToolResultMessage, id: string): ToolResultMessage {
  return plain({
    id,
    role: "toolResult",
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    // SAFETY: Pi AI text and image blocks are the transcript's content blocks.
    content: message.content as ToolResultMessage["content"],
    details: message.details,
    isError: message.isError,
    parentAssistantId: "",
    timestamp: message.timestamp,
  });
}

/** Whether an assistant message has anything to show: text, reasoning or a tool call. */
export function hasVisibleContent(message: { content: PiAssistantMessage["content"] }): boolean {
  return message.content.some((block) =>
    block.type === "text"
      ? block.text.length > 0
      : block.type === "thinking"
        ? block.thinking.length > 0
        : true,
  );
}
