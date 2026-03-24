import type { JsonValue } from "@/types/common"
import type { ChatMessage } from "@/types/chat"
import type { ProviderId, ThinkingLevel, Usage } from "@/types/models"

export interface RepoSource {
  owner: string
  ref: string
  repo: string
  token?: string
}

export interface SessionData {
  cost: number
  createdAt: string
  id: string
  messages: ChatMessage[]
  model: string
  preview: string
  provider: ProviderId
  repoSource?: RepoSource
  thinkingLevel: ThinkingLevel
  title: string
  updatedAt: string
  usage: Usage
}

export interface SessionMetadata {
  cost: number
  createdAt: string
  id: string
  lastModified: string
  messageCount: number
  model: string
  modelId: string
  preview: string
  provider: ProviderId
  thinkingLevel: ThinkingLevel
  title: string
  usage: Usage
}

export interface SettingsRow {
  key: string
  updatedAt: string
  value: JsonValue
}

export interface ProviderKeyRecord {
  provider: ProviderId
  updatedAt: string
  value: string
}

export type DailyCostByProvider = Partial<Record<ProviderId, Record<string, number>>>

export interface DailyCostAggregate {
  byProvider: DailyCostByProvider
  date: string
  total: number
}
