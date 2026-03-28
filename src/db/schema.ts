// Rebuilds the Sitegeist/web-ui Dexie contract with the same store split and local-only persistence model.
import Dexie, { type EntityTable, type Table } from "dexie"
import { getDateKey, getIsoNow } from "@/lib/dates"
import type {
  DailyCostAggregate,
  MessageRow,
  ProviderKeyRecord,
  RepositoryRow,
  SessionData,
  SettingsRow,
} from "@/types/storage"
import type { JsonValue } from "@/types/common"
import type { ProviderId, Usage } from "@/types/models"

const DB_NAME = "gitinspect-store"

export class AppDb extends Dexie {
  dailyCosts!: EntityTable<DailyCostAggregate, "date">
  messages!: EntityTable<MessageRow, "id">
  providerKeys!: EntityTable<ProviderKeyRecord, "provider">
  repositories!: Table<RepositoryRow, [string, string, string]>
  sessions!: EntityTable<SessionData, "id">
  settings!: EntityTable<SettingsRow, "key">

  constructor() {
    super(DB_NAME)
    this.version(1).stores({
      daily_costs: "date",
      messages:
        "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
      "provider-keys": "provider, updatedAt",
      repositories: "[owner+repo+ref], lastOpenedAt",
      sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
      settings: "key, updatedAt",
    })
    this.dailyCosts = this.table("daily_costs")
    this.messages = this.table("messages")
    this.providerKeys = this.table("provider-keys")
    this.repositories = this.table("repositories")
    this.sessions = this.table("sessions")
    this.settings = this.table("settings")
  }
}

export const db = new AppDb()

export async function touchRepository(
  source: Pick<RepositoryRow, "owner" | "repo" | "ref">
): Promise<void> {
  const owner = source.owner.trim()
  const repo = source.repo.trim()
  const ref = source.ref.trim()

  if (!owner || !repo || !ref) {
    return
  }

  await db.repositories.put({
    lastOpenedAt: getIsoNow(),
    owner,
    ref,
    repo,
  })
}

export async function listRepositories(): Promise<RepositoryRow[]> {
  return await db.repositories.orderBy("lastOpenedAt").reverse().toArray()
}

export async function putSession(session: SessionData): Promise<void> {
  await db.sessions.put(session)
}

export async function putMessage(message: MessageRow): Promise<void> {
  await db.messages.put(message)
}

export async function putMessages(messages: MessageRow[]): Promise<void> {
  if (messages.length === 0) {
    return
  }

  await db.messages.bulkPut(messages)
}

export async function putSessionAndMessages(
  session: SessionData,
  messages: MessageRow[]
): Promise<void> {
  await db.transaction("rw", db.sessions, db.messages, async () => {
    await db.sessions.put(session)
    await putMessages(messages)
  })
}

export async function getSession(id: string): Promise<SessionData | undefined> {
  return await db.sessions.get(id)
}

export async function getSessionMessages(sessionId: string): Promise<MessageRow[]> {
  return await db.messages
    .where("[sessionId+timestamp]")
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .sortBy("timestamp")
}

export async function listSessions(): Promise<SessionData[]> {
  return await db.sessions.orderBy("updatedAt").reverse().toArray()
}

export async function getLatestSessionId(): Promise<string | undefined> {
  return (await db.sessions.orderBy("updatedAt").reverse().first())
    ?.id
}

export async function getMostRecentSession(): Promise<SessionData | undefined> {
  const latestId = await getLatestSessionId()

  if (!latestId) {
    return undefined
  }

  return await getSession(latestId)
}

export async function deleteMessagesBySession(sessionId: string): Promise<void> {
  const messageIds = await db.messages
    .where("sessionId")
    .equals(sessionId)
    .primaryKeys()

  await db.messages.bulkDelete(messageIds)
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction("rw", db.sessions, db.messages, async () => {
    await db.sessions.delete(id)
    await deleteMessagesBySession(id)
  })
}

export type ChatDataExportV1 = {
  exportVersion: 1
  exportedAt: string
  sessions: Array<{
    messages: MessageRow[]
    session: SessionData
  }>
}

export async function exportAllChatData(): Promise<ChatDataExportV1> {
  const sessions = await listSessions()
  const sessionsWithMessages = await Promise.all(
    sessions.map(async (session) => ({
      messages: await getSessionMessages(session.id),
      session,
    }))
  )

  return {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    sessions: sessionsWithMessages,
  }
}

/**
 * Clears every persisted store (sessions, messages, settings, provider keys,
 * repositories, daily cost aggregates). Release runtime workers before calling.
 */
export async function deleteAllLocalData(): Promise<void> {
  await db.transaction(
    "rw",
    db.sessions,
    db.messages,
    db.settings,
    db.providerKeys,
    db.repositories,
    db.dailyCosts,
    async () => {
      await db.sessions.clear()
      await db.messages.clear()
      await db.settings.clear()
      await db.providerKeys.clear()
      await db.repositories.clear()
      await db.dailyCosts.clear()
    }
  )
}

export async function setSetting(
  key: string,
  value: JsonValue
): Promise<void> {
  await db.settings.put({
    key,
    updatedAt: getIsoNow(),
    value,
  })
}

export async function getSetting(key: string): Promise<JsonValue | undefined> {
  return (await db.settings.get(key))?.value
}

export async function getAllSettings(): Promise<SettingsRow[]> {
  return await db.settings.toArray()
}

export async function deleteSetting(key: string): Promise<void> {
  await db.settings.delete(key)
}

export async function setProviderKey(
  provider: ProviderId,
  value: string
): Promise<void> {
  await db.providerKeys.put({
    provider,
    updatedAt: getIsoNow(),
    value,
  })
}

export async function getProviderKey(
  provider: ProviderId
): Promise<ProviderKeyRecord | undefined> {
  return await db.providerKeys.get(provider)
}

export async function listProviderKeys(): Promise<ProviderKeyRecord[]> {
  return await db.providerKeys.toArray()
}

export async function deleteProviderKey(provider: ProviderId): Promise<void> {
  await db.providerKeys.delete(provider)
}

export async function getDailyCost(
  date: string
): Promise<DailyCostAggregate | undefined> {
  return await db.dailyCosts.get(date)
}

export function mergeDailyCostAggregate(
  current: DailyCostAggregate | undefined,
  usage: Usage,
  provider: ProviderId,
  model: string,
  at: Date | number | string = Date.now()
): DailyCostAggregate {
  const date = getDateKey(at)
  const providerTotals = current?.byProvider[provider] ?? {}
  const nextByProvider = {
    ...(current?.byProvider ?? {}),
    [provider]: {
      ...providerTotals,
      [model]: (providerTotals[model] ?? 0) + usage.cost.total,
    },
  }

  return {
    byProvider: nextByProvider,
    date,
    total: (current?.total ?? 0) + usage.cost.total,
  }
}

export async function recordUsage(
  usage: Usage,
  provider: ProviderId,
  model: string,
  at = Date.now()
): Promise<void> {
  const date = getDateKey(at)
  const current = await db.dailyCosts.get(date)
  const next = mergeDailyCostAggregate(current, usage, provider, model, at)
  await db.dailyCosts.put(next)
}

export async function listDailyCosts(): Promise<DailyCostAggregate[]> {
  return await db.dailyCosts.orderBy("date").reverse().toArray()
}

export function getTotalCostFromAggregates(
  dailyCosts: DailyCostAggregate[]
): number {
  return dailyCosts.reduce((total, daily) => total + daily.total, 0)
}

export async function getTotalCost(): Promise<number> {
  return getTotalCostFromAggregates(await listDailyCosts())
}

export function getCostsByProviderFromAggregates(
  dailyCosts: DailyCostAggregate[]
): Partial<Record<ProviderId, number>> {
  const totals: Partial<Record<ProviderId, number>> = {}

  for (const daily of dailyCosts) {
    for (const [provider, models] of Object.entries(daily.byProvider) as Array<
      [ProviderId, Record<string, number> | undefined]
    >) {
      const sum = Object.values(models ?? {}).reduce(
        (subtotal, value) => subtotal + value,
        0
      )
      totals[provider] = (totals[provider] ?? 0) + sum
    }
  }

  return totals
}

export async function getCostsByProvider(): Promise<
  Partial<Record<ProviderId, number>>
> {
  return getCostsByProviderFromAggregates(await listDailyCosts())
}

export function getCostsByModelFromAggregates(
  dailyCosts: DailyCostAggregate[]
): Record<string, number> {
  const totals: Record<string, number> = {}

  for (const daily of dailyCosts) {
    for (const models of Object.values(daily.byProvider)) {
      for (const [model, value] of Object.entries(models ?? {})) {
        totals[model] = (totals[model] ?? 0) + value
      }
    }
  }

  return totals
}

export async function getCostsByModel(): Promise<Record<string, number>> {
  return getCostsByModelFromAggregates(await listDailyCosts())
}
