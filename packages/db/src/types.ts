import type { JsonValue } from "@gitinspect/pi/types/common";
import type { AssistantMessage, ChatMessage } from "@gitinspect/pi/types/chat";
import type {
  ProviderGroupId,
  ProviderId,
  ThinkingLevel,
  Usage,
} from "@gitinspect/pi/types/models";

export type RepoRefOrigin = "default" | "explicit";

export type ResolvedRepoRef =
  | {
      apiRef: `heads/${string}`;
      fullRef: `refs/heads/${string}`;
      kind: "branch";
      name: string;
    }
  | {
      apiRef: `tags/${string}`;
      fullRef: `refs/tags/${string}`;
      kind: "tag";
      name: string;
    }
  | {
      kind: "commit";
      sha: string;
    };

export interface ResolvedRepoSource {
  owner: string;
  repo: string;
  ref: string;
  refOrigin: RepoRefOrigin;
  resolvedRef: ResolvedRepoRef;
}

export interface RepositoryRow {
  lastOpenedAt: string;
  owner: string;
  ref: string;
  refOrigin: RepoRefOrigin;
  repo: string;
}

export interface SessionData {
  cost: number;
  createdAt: string;
  error?: string;
  id: string;
  isStreaming: boolean;
  messageCount: number;
  model: string;
  preview: string;
  provider: ProviderId;
  providerGroup?: ProviderGroupId;
  repoSource?: ResolvedRepoSource;
  sourceUrl?: string;
  thinkingLevel: ThinkingLevel;
  title: string;
  updatedAt: string;
  usage: Usage;
}

export type MessageStatus = "aborted" | "completed" | "error" | "streaming";

export type MessageRow = ChatMessage & {
  order: number;
  sessionId: string;
  status: MessageStatus;
};

export type SyncedSessionRow = SessionData & {
  owner?: string;
  realmId?: string;
};

export type SyncedMessageRow = MessageRow & {
  owner?: string;
  realmId?: string;
};

export interface SessionLeaseRow {
  acquiredAt: string;
  heartbeatAt: string;
  ownerTabId: string;
  ownerToken: string;
  sessionId: string;
}

export type RuntimePhase = "idle" | "interrupted" | "running";

export type RuntimeTerminalStatus = "aborted" | "completed" | "error";

export type SessionRuntimeStatus =
  | "aborted"
  | "completed"
  | "error"
  | "idle"
  | "interrupted"
  | "streaming";

export interface SessionRuntimeRow {
  assistantMessageId?: string;
  lastError?: string;
  lastProgressAt?: string;
  lastTerminalStatus?: RuntimeTerminalStatus;
  ownerTabId?: string;
  pendingToolCallOwners?: Record<string, string>;
  phase?: RuntimePhase;
  sessionId: string;
  startedAt?: string;
  status?: SessionRuntimeStatus;
  streamMessage?: AssistantMessage;
  turnId?: string;
  updatedAt: string;
}

export interface SettingsRow {
  key: string;
  updatedAt: string;
  value: JsonValue;
}

export interface ProviderKeyRecord {
  provider: ProviderId;
  updatedAt: string;
  value: string;
}

export type DailyCostByProvider = Partial<Record<ProviderId, Record<string, number>>>;

export interface DailyCostAggregate {
  byProvider: DailyCostByProvider;
  date: string;
  total: number;
}
