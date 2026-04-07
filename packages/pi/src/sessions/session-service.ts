import {
  db,
  deleteSessionRuntime,
  getMostRecentSession,
  getSession,
  getSessionMessages,
  getSessionRuntime,
  putSession,
  putSessionRuntime,
  runConversationTransaction,
} from "@gitinspect/db/schema";
import { loadSessionLeaseState } from "@gitinspect/db/session-leases";
import { normalizeSessionRuntime } from "@gitinspect/db/session-runtime";
import { linkToolResults } from "@gitinspect/pi/agent/tool-result-linker";
import { StreamInterruptedRuntimeError } from "@gitinspect/pi/agent/runtime-command-errors";
import { getIsoNow } from "@gitinspect/pi/lib/dates";
import { createId } from "@gitinspect/pi/lib/ids";
import { getCanonicalProvider, getDefaultProviderGroup } from "@gitinspect/pi/models/catalog";
import {
  buildPreview,
  generateTitle,
  hasPersistableExchange,
} from "@gitinspect/pi/sessions/session-metadata";
import type { AssistantMessage, ChatMessage } from "@gitinspect/pi/types/chat";
import {
  createEmptyUsage,
  type ProviderGroupId,
  type ThinkingLevel,
  type Usage,
} from "@gitinspect/pi/types/models";
import type {
  MessageRow,
  ResolvedRepoSource,
  SessionData,
  SessionRuntimeRow,
} from "@gitinspect/db/storage-types";

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

function sortMessagesForOrder(messages: readonly MessageRow[]): MessageRow[] {
  return [...messages].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
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
  const sorted = [...messages].sort((left, right) => {
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

  let changed = false;
  const ordered = sorted.map((message, index) => {
    if (message.order === index) {
      return message;
    }

    changed = true;
    return {
      ...message,
      order: index,
    };
  });

  return {
    changed,
    messages: ordered,
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

function buildInterruptedRuntimeFromMessage(
  sessionId: string,
  message: MessageRow,
  runtime: SessionRuntimeRow | undefined,
): SessionRuntimeRow | undefined {
  if (message.role !== "assistant") {
    return runtime;
  }

  if (runtime?.streamMessage) {
    return runtime;
  }

  const assistantDraft: AssistantMessage = {
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

  return {
    ...runtime,
    lastError: runtime?.lastError ?? new StreamInterruptedRuntimeError().message,
    lastProgressAt: runtime?.lastProgressAt ?? getIsoNow(),
    ownerTabId: undefined,
    pendingToolCallOwners: {},
    phase: "interrupted",
    sessionId,
    status:
      runtime?.status === "aborted" || runtime?.status === "error" ? runtime.status : "interrupted",
    streamMessage: assistantDraft,
    turnId: undefined,
    updatedAt: getIsoNow(),
  };
}

export function createSession(params: {
  model: string;
  providerGroup: ProviderGroupId;
  repoSource?: ResolvedRepoSource;
  sourceUrl?: string;
  thinkingLevel?: ThinkingLevel;
}): SessionData {
  const now = getIsoNow();
  const provider = getCanonicalProvider(params.providerGroup);

  return {
    cost: 0,
    createdAt: now,
    error: undefined,
    id: createId(),
    isStreaming: false,
    messageCount: 0,
    model: params.model,
    preview: "",
    provider,
    providerGroup: params.providerGroup,
    repoSource: params.repoSource,
    sourceUrl: params.sourceUrl,
    thinkingLevel: params.thinkingLevel ?? "medium",
    title: "New chat",
    updatedAt: now,
    usage: createEmptyUsage(),
  };
}

export async function persistSession(session: SessionData): Promise<void> {
  await putSession(normalizeSessionProviderGroup(session));
}

export async function persistSessionSnapshot(session: SessionData): Promise<void> {
  await persistSession(session);
}

export async function loadSession(id: string): Promise<SessionData | undefined> {
  const session = await getSession(id);
  return session ? normalizeSessionProviderGroup(session) : undefined;
}

export async function loadMostRecentSession(): Promise<SessionData | undefined> {
  const session = await getMostRecentSession();
  return session ? normalizeSessionProviderGroup(session) : undefined;
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

export function sanitizeLegacySession(params: {
  messages: MessageRow[];
  runtime?: SessionRuntimeRow;
  session: SessionData;
  options?: {
    allowInterruptedHydration?: boolean;
  };
}): {
  changed: boolean;
  messages: MessageRow[];
  runtime?: SessionRuntimeRow;
  session: SessionData;
} {
  const normalizedSession = normalizeSessionProviderGroup(params.session);
  const ordered = assignMessageOrder(params.messages);
  const streamingMessages = ordered.messages.filter((message) => message.status === "streaming");
  const completedMessages = ordered.messages.filter((message) => message.status !== "streaming");
  const linked = linkToolResults(completedMessages);
  const orderedLinkedMessages = assignMessageOrder(
    sortMessagesForOrder(linked.messages as MessageRow[]),
  );
  const allowInterruptedHydration = params.options?.allowInterruptedHydration ?? true;
  let runtime = normalizeSessionRuntime(normalizedSession.id, params.runtime);

  if (allowInterruptedHydration && !runtime && streamingMessages.length > 0) {
    runtime = {
      lastError: new StreamInterruptedRuntimeError().message,
      lastProgressAt: getIsoNow(),
      pendingToolCallOwners: {},
      phase: "interrupted",
      sessionId: normalizedSession.id,
      status: "interrupted",
      updatedAt: getIsoNow(),
    };
  }

  if (allowInterruptedHydration && streamingMessages.length > 0) {
    runtime = streamingMessages.reduce<SessionRuntimeRow | undefined>(
      (currentRuntime, message) =>
        buildInterruptedRuntimeFromMessage(normalizedSession.id, message, currentRuntime),
      runtime,
    );
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
    orderedLinkedMessages.messages,
  );

  const changed =
    ordered.changed ||
    streamingMessages.length > 0 ||
    linked.changed ||
    orderedLinkedMessages.changed ||
    !areRuntimeEqual(runtime, params.runtime) ||
    !areSessionsEqual(nextSession, normalizedSession) ||
    !areMessagesEqual(orderedLinkedMessages.messages, params.messages);

  return {
    changed,
    messages: orderedLinkedMessages.messages,
    runtime,
    session: nextSession,
  };
}

async function replaceSanitizedSessionState(params: {
  messages: MessageRow[];
  runtime?: SessionRuntimeRow;
  session: SessionData;
}): Promise<void> {
  await runConversationTransaction(async () => {
    const existingMessages = await db.messages
      .where("sessionId")
      .equals(params.session.id)
      .toArray();
    const nextMessageIds = new Set(params.messages.map((message) => message.id));
    const deletedMessageIds = existingMessages
      .filter((message) => !nextMessageIds.has(message.id))
      .map((message) => message.id);

    await db.sessions.put(params.session);

    if (deletedMessageIds.length > 0) {
      await db.messages.bulkDelete(deletedMessageIds);
    }

    if (params.messages.length > 0) {
      await db.messages.bulkPut(params.messages);
    }

    if (params.runtime) {
      await putSessionRuntime(params.runtime);
    } else {
      await deleteSessionRuntime(params.session.id);
    }
  });
}

export async function loadSessionWithMessages(
  id: string,
  options: { persistSanitized?: boolean } = {},
): Promise<
  { messages: MessageRow[]; runtime?: SessionRuntimeRow; session: SessionData } | undefined
> {
  const [session, messages, runtime] = await Promise.all([
    loadSession(id),
    getSessionMessages(id),
    getSessionRuntime(id),
  ]);

  if (!session) {
    return undefined;
  }

  const normalizedRuntime = normalizeSessionRuntime(id, runtime);
  const leaseState = await loadSessionLeaseState(id);
  const hasLiveLease = leaseState.kind === "locked" || leaseState.kind === "owned";
  const sanitized = sanitizeLegacySession({
    messages,
    options: {
      allowInterruptedHydration: normalizedRuntime?.phase !== "running" && !hasLiveLease,
    },
    runtime,
    session,
  });

  if (sanitized.changed && options.persistSanitized !== false) {
    if (sanitized.runtime?.phase !== "running" && !hasLiveLease) {
      await replaceSanitizedSessionState(sanitized);
    }
  }

  return sanitized;
}
