import { getIsoNow } from "@/lib/dates"
import { createId } from "@/lib/ids"
import { getCanonicalProvider, getDefaultProviderGroup } from "@/models/catalog"
import { normalizeRepoSource } from "@/repo/settings"
import {
  buildPreview,
  generateTitle,
  hasPersistableExchange,
} from "@/sessions/session-metadata"
import {
  getMostRecentSession,
  getSession,
  getSessionMessages,
  putSession,
} from "@/db/schema"
import {
  createEmptyUsage,
  type ProviderGroupId,
  type ThinkingLevel,
  type Usage,
} from "@/types/models"
import type { ChatMessage } from "@/types/chat"
import type { MessageRow, RepoSource, SessionData } from "@/types/storage"

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
  }
}

function toChatMessage(message: ChatMessage | MessageRow): ChatMessage {
  const { sessionId: _sessionId, status: _status, ...chatMessage } =
    message as MessageRow
  return chatMessage as ChatMessage
}

export function createSession(params: {
  model: string
  providerGroup: ProviderGroupId
  repoSource?: RepoSource
  thinkingLevel?: ThinkingLevel
}): SessionData {
  const now = getIsoNow()
  const provider = getCanonicalProvider(params.providerGroup)

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
    repoSource: normalizeRepoSource(params.repoSource),
    thinkingLevel: params.thinkingLevel ?? "medium",
    title: "New chat",
    updatedAt: now,
    usage: createEmptyUsage(),
  }
}

export async function persistSession(session: SessionData): Promise<void> {
  await putSession(normalizeSessionProviderGroup(session))
}

export async function persistSessionSnapshot(
  session: SessionData
): Promise<void> {
  await persistSession(session)
}

export async function loadSession(id: string): Promise<SessionData | undefined> {
  const session = await getSession(id)
  return session ? normalizeSessionProviderGroup(session) : undefined
}

export async function loadMostRecentSession(): Promise<SessionData | undefined> {
  const session = await getMostRecentSession()
  return session ? normalizeSessionProviderGroup(session) : undefined
}

export async function loadSessionWithMessages(
  id: string
): Promise<{ messages: MessageRow[]; session: SessionData } | undefined> {
  const session = await loadSession(id)

  if (!session) {
    return undefined
  }

  return {
    messages: await getSessionMessages(id),
    session,
  }
}

export function aggregateSessionUsage(
  messages: Array<ChatMessage | MessageRow>
): Usage {
  return messages.reduce((usage, message) => {
    if (message.role !== "assistant") {
      return usage
    }

    return mergeUsage(usage, message.usage)
  }, createEmptyUsage())
}

export function buildPersistedSession(
  session: SessionData,
  messages: Array<ChatMessage | MessageRow>
): SessionData {
  const normalizedSession = normalizeSessionProviderGroup(session)
  const chatMessages = messages.map(toChatMessage)
  const usage = aggregateSessionUsage(chatMessages)

  return {
    ...normalizedSession,
    cost: usage.cost.total,
    error: normalizedSession.error,
    isStreaming: normalizedSession.isStreaming,
    messageCount: chatMessages.length,
    preview: buildPreview(chatMessages),
    repoSource: normalizeRepoSource(normalizedSession.repoSource),
    title: generateTitle(chatMessages),
    updatedAt: normalizedSession.updatedAt,
    usage,
  }
}

export function shouldSaveSession(
  messages: Array<ChatMessage | MessageRow>
): boolean {
  return hasPersistableExchange(messages.map(toChatMessage))
}

export function normalizeSessionProviderGroup(session: SessionData): SessionData {
  const providerGroup =
    session.providerGroup ?? getDefaultProviderGroup(session.provider)

  return {
    ...session,
    provider: getCanonicalProvider(providerGroup),
    providerGroup,
  }
}
