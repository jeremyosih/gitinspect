import type { JsonValue } from "@/types/common"
import type { ChatMessage } from "@/types/chat"
import type {
  ProviderGroupId,
  ProviderId,
  ThinkingLevel,
  Usage,
} from "@/types/models"

export interface RepoSource {
  owner: string
  repo: string
  ref: string
  token?: string
}

export interface RepoTarget {
  owner: string
  repo: string
  ref?: string
  token?: string
}

export interface RepositoryRow {
  lastOpenedAt: string
  owner: string
  ref: string
  repo: string
}

export interface SessionData {
  cost: number
  createdAt: string
  error?: string
  id: string
  isStreaming: boolean
  messageCount: number
  model: string
  preview: string
  provider: ProviderId
  providerGroup?: ProviderGroupId
  repoSource?: RepoSource
  thinkingLevel: ThinkingLevel
  title: string
  updatedAt: string
  usage: Usage
}

export type MessageStatus = "aborted" | "completed" | "error" | "streaming"

export type MessageRow = ChatMessage & {
  sessionId: string
  status: MessageStatus
}

export interface SessionLeaseRow {
  acquiredAt: string
  heartbeatAt: string
  ownerTabId: string
  ownerToken: string
  sessionId: string
}

export type SessionRuntimeStatus =
  | "aborted"
  | "completed"
  | "error"
  | "idle"
  | "interrupted"
  | "streaming"

export interface SessionRuntimeRow {
  assistantMessageId?: string
  lastError?: string
  lastProgressAt?: string
  ownerTabId?: string
  sessionId: string
  startedAt?: string
  status: SessionRuntimeStatus
  turnId?: string
  updatedAt: string
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

export type DailyCostByProvider = Partial<
  Record<ProviderId, Record<string, number>>
>

export interface DailyCostAggregate {
  byProvider: DailyCostByProvider
  date: string
  total: number
}
