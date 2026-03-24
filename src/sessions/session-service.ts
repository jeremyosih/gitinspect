// Mirrors Sitegeist session persistence rules: derive metadata on save and avoid persisting empty conversations.
import { createId } from "@/lib/ids"
import { getIsoNow } from "@/lib/dates"
import { createEmptyUsage, type ProviderId, type ThinkingLevel } from "@/types/models"
import { getMostRecentSession, getSession, saveSession } from "@/db/schema"
import type { RepoSource, SessionData } from "@/types/storage"
import type { Usage } from "@/types/models"
import { buildPreview, buildSessionMetadata, generateTitle, hasPersistableExchange } from "@/sessions/session-metadata"
import { normalizeRepoSource } from "@/repo/settings"

export function createSession(params: {
  model: string
  provider: ProviderId
  repoSource?: RepoSource
  thinkingLevel?: ThinkingLevel
}): SessionData {
  const now = getIsoNow()

  return {
    cost: 0,
    createdAt: now,
    id: createId(),
    messages: [],
    model: params.model,
    preview: "",
    provider: params.provider,
    repoSource: normalizeRepoSource(params.repoSource),
    thinkingLevel: params.thinkingLevel ?? "medium",
    title: "New chat",
    updatedAt: now,
    usage: createEmptyUsage(),
  }
}

export async function persistSession(session: SessionData): Promise<void> {
  if (!shouldSaveSession(session)) {
    return
  }

  const persistedSession = buildPersistedSession(session)
  await saveSession(persistedSession, buildSessionMetadata(persistedSession))
}

export async function loadSession(id: string): Promise<SessionData | undefined> {
  return await getSession(id)
}

export async function loadMostRecentSession(): Promise<SessionData | undefined> {
  return await getMostRecentSession()
}

export function updateSessionSummaries(session: SessionData): SessionData {
  return {
    ...session,
    preview: buildPreview(session.messages),
    title: generateTitle(session.messages),
  }
}

export function shouldSaveSession(session: SessionData): boolean {
  return hasPersistableExchange(session.messages)
}

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

export function aggregateSessionUsage(session: SessionData): Usage {
  return session.messages.reduce((usage, message) => {
    if (message.role !== "assistant") {
      return usage
    }

    return mergeUsage(usage, message.usage)
  }, createEmptyUsage())
}

export function buildPersistedSession(session: SessionData): SessionData {
  const usage = aggregateSessionUsage(session)

  return updateSessionSummaries({
    ...session,
    cost: usage.cost.total,
    createdAt: session.createdAt,
    repoSource: normalizeRepoSource(session.repoSource),
    usage,
  })
}
