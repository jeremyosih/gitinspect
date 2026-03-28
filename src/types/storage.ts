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

/**
 * Session bootstrap lifecycle (worker runs `AgentHost` after Dexie has a row).
 *
 * - `bootstrap`: row exists; first prompt not yet durably started (`persistPromptStart` in
 *   `session-persistence.ts` promotes to `ready`).
 * - `ready`: normal chat; also the default when `bootstrapStatus` is missing in older rows.
 * - `failed`: repo resolution or first-send failed; see `session-bootstrap.ts` + notices.
 */
export type BootstrapStatus = "bootstrap" | "failed" | "ready"

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
  bootstrapStatus: BootstrapStatus
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
