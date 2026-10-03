import { normalizeSessionRuntime } from "@gitinspect/db/session-runtime-normalization";
import { linkToolResults } from "@gitinspect/shared/agent/tool-result-linker";
import { StreamInterruptedRuntimeError } from "@gitinspect/shared/agent/runtime-command-errors";
import { getCanonicalProvider, getDefaultProviderGroup } from "@gitinspect/shared/models/providers";
import {
  buildPreview,
  generateTitle,
  hasPersistableExchange,
} from "@gitinspect/shared/sessions/session-metadata";
import { createEmptyUsage, type Usage } from "@gitinspect/shared/types/models";
import type { AssistantMessage, ChatMessage } from "@gitinspect/shared/types/chat";
import type { MessageRow, SessionData, SessionRuntimeRow } from "@gitinspect/db";

function mergeUsage(left: Usage, right: Usage): Usage {
  return {
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    cost: {
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      total: left.cost.total + right.cost.total,
    },
    input: left.input + right.input,
    output: left.output + right.output,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function toChatMessage(message: ChatMessage | MessageRow): ChatMessage {
  const {
    order: _order,
    sessionId: _sessionId,
    status: _status,
    ...chatMessage
  } = message as MessageRow;
  return chatMessage as ChatMessage;
}

function isAssistantRow(
  message: MessageRow,
): message is Extract<MessageRow, { role: "assistant" }> {
  return message.role === "assistant";
}

function sortMessagesForOrder(messages: readonly MessageRow[]): MessageRow[] {
  return [...messages].sort((left, right) => {
    const leftOrder = Number.isFinite(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right.order) ? right.order : Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }

    return left.id.localeCompare(right.id);
  });
}

function assignMessageOrder(messages: readonly MessageRow[]): {
  changed: boolean;
  messages: MessageRow[];
} {
  const sorted = sortMessagesForOrder(messages);
  let changed = false;

  return {
    changed,
    messages: sorted.map((message, index) => {
      if (message.order === index) {
        return message;
      }

      changed = true;
      return {
        ...message,
        order: index,
      };
    }),
  };
}

function areMessagesEqual(left: readonly MessageRow[], right: readonly MessageRow[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areRuntimeEqual(
  left: SessionRuntimeRow | undefined,
  right: SessionRuntimeRow | undefined,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function areSessionsEqual(left: SessionData, right: SessionData): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toAssistantDraft(message: Extract<MessageRow, { role: "assistant" }>): AssistantMessage {
  return {
    api: message.api,
    content: message.content,
    errorMessage: message.errorMessage,
    id: message.id,
    model: message.model,
    provider: message.provider,
    responseId: message.responseId,
    role: "assistant",
    stopReason: message.stopReason,
    timestamp: message.timestamp,
    usage: message.usage,
  };
}

function recoverStreamingAssistantDraft(
  messages: readonly MessageRow[],
): AssistantMessage | undefined {
  const latestAssistant = [...messages].reverse().find(isAssistantRow);
  return latestAssistant ? toAssistantDraft(latestAssistant) : undefined;
}

function createInterruptedRuntime(params: {
  draft: AssistantMessage;
  now: string;
  sessionId: string;
}): SessionRuntimeRow {
  return {
    lastError: new StreamInterruptedRuntimeError().message,
    lastProgressAt: params.now,
    pendingToolCallOwners: {},
    phase: "interrupted",
    sessionId: params.sessionId,
    status: "interrupted",
    streamMessage: params.draft,
    updatedAt: params.now,
  };
}

export function aggregateSessionUsage(messages: Array<ChatMessage | MessageRow>): Usage {
  return messages.reduce((usage, message) => {
    if (message.role !== "assistant") {
      return usage;
    }

    return mergeUsage(usage, message.usage);
  }, createEmptyUsage());
}

export function buildPersistedSession(
  session: SessionData,
  messages: Array<ChatMessage | MessageRow>,
): SessionData {
  const normalizedSession = normalizeSessionProviderGroup(session);
  const chatMessages = messages.map(toChatMessage);
  const usage = aggregateSessionUsage(chatMessages);

  return {
    ...normalizedSession,
    cost: usage.cost.total,
    error: normalizedSession.error,
    isStreaming: normalizedSession.isStreaming,
    messageCount: chatMessages.length,
    preview: buildPreview(chatMessages),
    repoSource: normalizedSession.repoSource,
    sourceUrl: normalizedSession.sourceUrl,
    title: generateTitle(chatMessages),
    updatedAt: normalizedSession.updatedAt,
    usage,
  };
}

export function shouldSaveSession(messages: Array<ChatMessage | MessageRow>): boolean {
  return hasPersistableExchange(messages.map(toChatMessage));
}

export function normalizeSessionProviderGroup(session: SessionData): SessionData {
  const providerGroup = session.providerGroup ?? getDefaultProviderGroup(session.provider);

  return {
    ...session,
    provider: getCanonicalProvider(providerGroup),
    providerGroup,
  };
}

export function normalizePersistedSessionState(input: {
  messages: MessageRow[];
  runtime?: SessionRuntimeRow;
  session: SessionData;
  options?: {
    allowInterruptedHydration?: boolean;
    now?: string;
  };
}): {
  changed: boolean;
  deletedMessageIds: string[];
  messages: MessageRow[];
  runtime?: SessionRuntimeRow;
  session: SessionData;
} {
  const normalizedSession = normalizeSessionProviderGroup(input.session);
  const ordered = assignMessageOrder(input.messages);
  const streamingMessages = ordered.messages.filter((message) => message.status === "streaming");
  const completedMessages = ordered.messages.filter((message) => message.status !== "streaming");
  const linked = linkToolResults(completedMessages);
  const normalizedTranscript = assignMessageOrder(linked.messages as MessageRow[]);
  const deletedMessageIds = ordered.messages
    .filter(
      (message) =>
        !normalizedTranscript.messages.some((nextMessage) => nextMessage.id === message.id),
    )
    .map((message) => message.id);
  const allowInterruptedHydration = input.options?.allowInterruptedHydration ?? true;
  const recoveredDraft = recoverStreamingAssistantDraft(streamingMessages);
  let runtime = normalizeSessionRuntime(normalizedSession.id, input.runtime);

  if (allowInterruptedHydration && recoveredDraft) {
    if (!runtime) {
      runtime = createInterruptedRuntime({
        draft: recoveredDraft,
        now: input.options?.now ?? normalizedSession.updatedAt,
        sessionId: normalizedSession.id,
      });
    } else if (!runtime.streamMessage) {
      runtime = {
        ...runtime,
        streamMessage: recoveredDraft,
      };
    }
  }

  const nextSession = buildPersistedSession(
    {
      ...normalizedSession,
      isStreaming:
        runtime?.phase === "running" ||
        (!allowInterruptedHydration &&
          normalizedSession.isStreaming &&
          streamingMessages.length > 0),
    },
    normalizedTranscript.messages,
  );

  return {
    changed:
      ordered.changed ||
      linked.changed ||
      normalizedTranscript.changed ||
      deletedMessageIds.length > 0 ||
      !areRuntimeEqual(runtime, input.runtime) ||
      !areSessionsEqual(nextSession, normalizedSession) ||
      !areMessagesEqual(normalizedTranscript.messages, input.messages),
    deletedMessageIds,
    messages: normalizedTranscript.messages,
    runtime,
    session: nextSession,
  };
}
