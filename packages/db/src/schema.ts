import Dexie, { type Table } from "dexie";
import {
  createBranchRepoRef,
  createCommitRepoRef,
  createTagRepoRef,
  displayResolvedRepoRef,
} from "@gitinspect/pi/repo/refs";
import type {
  MessageRow,
  RepoRefOrigin,
  ResolvedRepoRef,
  ResolvedRepoSource,
  RepositoryRow,
  RuntimePhase,
  SessionData,
  SessionRuntimeRow,
  SessionRuntimeStatus,
} from "./types";

export const DB_NAME = "gitinspect-store";

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

type LegacyRepositoryRow = Omit<RepositoryRow, "refOrigin"> & {
  refOrigin?: RepoRefOrigin;
};

type LegacySessionRepoSource = {
  owner?: string;
  ref?: string;
  refOrigin?: RepoRefOrigin;
  repo?: string;
  resolvedRef?: ResolvedRepoRef;
  token?: string;
};

type LegacySessionData = Omit<SessionData, "repoSource"> & {
  repoSource?: LegacySessionRepoSource;
};

type LegacyMessageRow = Omit<MessageRow, "order"> & {
  order?: number;
};

type LegacySessionRuntimeRow = Omit<SessionRuntimeRow, "phase"> & {
  phase?: RuntimePhase;
};

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeResolvedRepoRef(ref: ResolvedRepoRef | undefined): ResolvedRepoRef | undefined {
  if (!ref) {
    return undefined;
  }

  if (ref.kind === "commit") {
    const sha = trimToUndefined(ref.sha);
    return sha ? createCommitRepoRef(sha) : undefined;
  }

  const name = trimToUndefined(ref.name);

  if (!name) {
    return undefined;
  }

  return ref.kind === "branch" ? createBranchRepoRef(name) : createTagRepoRef(name);
}

function resolveDeterministicLegacyRef(ref: string): ResolvedRepoRef | undefined {
  if (FULL_COMMIT_SHA_PATTERN.test(ref)) {
    return createCommitRepoRef(ref);
  }

  if (ref.startsWith("refs/heads/")) {
    const name = trimToUndefined(ref.slice("refs/heads/".length));
    return name ? createBranchRepoRef(name) : undefined;
  }

  if (ref.startsWith("heads/")) {
    const name = trimToUndefined(ref.slice("heads/".length));
    return name ? createBranchRepoRef(name) : undefined;
  }

  if (ref.startsWith("refs/tags/")) {
    const name = trimToUndefined(ref.slice("refs/tags/".length));
    return name ? createTagRepoRef(name) : undefined;
  }

  if (ref.startsWith("tags/")) {
    const name = trimToUndefined(ref.slice("tags/".length));
    return name ? createTagRepoRef(name) : undefined;
  }

  return undefined;
}

function deriveRuntimePhase(status: SessionRuntimeStatus | undefined): RuntimePhase {
  switch (status) {
    case "streaming":
      return "running";
    case "interrupted":
    case "aborted":
    case "error":
      return "interrupted";
    default:
      return "idle";
  }
}

function sortMessagesForOrder(messages: LegacyMessageRow[]): LegacyMessageRow[] {
  return [...messages].sort((left, right) => {
    const leftOrder = typeof left.order === "number" ? left.order : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right.order === "number" ? right.order : Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }

    return left.id.localeCompare(right.id);
  });
}

async function backfillMessageOrder(table: Table<LegacyMessageRow, string>): Promise<void> {
  const messages = await table.toArray();
  const bySession = new Map<string, LegacyMessageRow[]>();

  for (const message of messages) {
    const sessionMessages = bySession.get(message.sessionId);

    if (sessionMessages) {
      sessionMessages.push(message);
      continue;
    }

    bySession.set(message.sessionId, [message]);
  }

  const updates: LegacyMessageRow[] = [];

  for (const sessionMessages of bySession.values()) {
    sortMessagesForOrder(sessionMessages).forEach((message, index) => {
      if (message.order === index) {
        return;
      }

      updates.push({
        ...message,
        order: index,
      });
    });
  }

  if (updates.length > 0) {
    await table.bulkPut(updates);
  }
}

async function backfillRuntimePhase(table: Table<LegacySessionRuntimeRow, string>): Promise<void> {
  const runtimes = await table.toArray();
  const updates = runtimes.flatMap((runtime) => {
    const phase = runtime.phase ?? deriveRuntimePhase(runtime.status);
    return runtime.phase === phase
      ? []
      : [
          {
            ...runtime,
            phase,
          },
        ];
  });

  if (updates.length > 0) {
    await table.bulkPut(updates);
  }
}

function migrateLegacyRepoSource(
  source: LegacySessionRepoSource | undefined,
): ResolvedRepoSource | undefined {
  if (!source) {
    return undefined;
  }

  const owner = trimToUndefined(source.owner);
  const repo = trimToUndefined(source.repo);
  const ref = trimToUndefined(source.ref);

  if (!owner || !repo || !ref) {
    return undefined;
  }

  const resolvedRef =
    normalizeResolvedRepoRef(source.resolvedRef) ?? resolveDeterministicLegacyRef(ref);

  if (!resolvedRef) {
    return undefined;
  }

  return {
    owner,
    ref: displayResolvedRepoRef(resolvedRef),
    refOrigin: source.refOrigin ?? "explicit",
    repo,
    resolvedRef,
  };
}

export function registerAppDbSchema(db: Dexie): void {
  db.version(1).stores({
    daily_costs: "date",
    messages: "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
    "provider-keys": "provider, updatedAt",
    repositories: "[owner+repo+ref], lastOpenedAt",
    sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
    settings: "key, updatedAt",
  });

  db.version(2).stores({
    daily_costs: "date",
    messages: "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
    "provider-keys": "provider, updatedAt",
    repositories: "[owner+repo+ref], lastOpenedAt",
    session_leases: "sessionId, ownerTabId, heartbeatAt",
    session_runtime: "sessionId, status, ownerTabId, lastProgressAt, updatedAt",
    sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
    settings: "key, updatedAt",
  });

  db.version(3)
    .stores({
      daily_costs: "date",
      messages: "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
      "provider-keys": "provider, updatedAt",
      repositories: "[owner+repo+ref], lastOpenedAt",
      session_leases: "sessionId, ownerTabId, heartbeatAt",
      session_runtime: "sessionId, status, ownerTabId, lastProgressAt, updatedAt",
      sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
      settings: "key, updatedAt",
    })
    .upgrade(async (tx) => {
      const repositories = tx.table("repositories") as Table<
        LegacyRepositoryRow,
        [string, string, string]
      >;
      await repositories.toCollection().modify((row) => {
        if (row.refOrigin === undefined) {
          row.refOrigin = "explicit";
        }
      });
    });

  db.version(4)
    .stores({
      daily_costs: "date",
      messages: "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
      "provider-keys": "provider, updatedAt",
      repositories: "[owner+repo+ref], lastOpenedAt",
      session_leases: "sessionId, ownerTabId, heartbeatAt",
      session_runtime: "sessionId, status, ownerTabId, lastProgressAt, updatedAt",
      sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
      settings: "key, updatedAt",
    })
    .upgrade(async (tx) => {
      const repositories = tx.table("repositories") as Table<
        LegacyRepositoryRow,
        [string, string, string]
      >;
      await repositories.toCollection().modify((row) => {
        if (row.refOrigin === undefined) {
          row.refOrigin = "explicit";
        }
      });

      const sessions = tx.table("sessions") as Table<LegacySessionData, string>;
      await sessions.toCollection().modify((row) => {
        row.repoSource = migrateLegacyRepoSource(row.repoSource);
      });
    });

  db.version(5)
    .stores({
      daily_costs: "date",
      messages:
        "id, sessionId, [sessionId+order], [sessionId+timestamp], [sessionId+status], order, timestamp, status",
      "provider-keys": "provider, updatedAt",
      repositories: "[owner+repo+ref], lastOpenedAt",
      session_leases: "sessionId, ownerTabId, heartbeatAt",
      session_runtime: "sessionId, phase, status, ownerTabId, lastProgressAt, updatedAt",
      sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
      settings: "key, updatedAt",
    })
    .upgrade(async (tx) => {
      const messages = tx.table("messages") as Table<LegacyMessageRow, string>;
      const runtime = tx.table("session_runtime") as Table<LegacySessionRuntimeRow, string>;

      await backfillMessageOrder(messages);
      await backfillRuntimePhase(runtime);
    });

  db.version(6).stores({
    daily_costs: "date",
    messages:
      "id, sessionId, [sessionId+order], [sessionId+timestamp], [sessionId+status], order, timestamp, status",
    "provider-keys": "provider, updatedAt",
    publicMessages: "id, sessionId, [sessionId+order], order, timestamp",
    publicSessions: "id, publishedAt, updatedAt",
    repositories: "[owner+repo+ref], lastOpenedAt",
    session_leases: "sessionId, ownerTabId, heartbeatAt",
    session_runtime: "sessionId, phase, status, ownerTabId, lastProgressAt, updatedAt",
    sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
    settings: "key, updatedAt",
    shareOwners: "id, ownerUserId, realmId, updatedAt",
  });

  db.version(7).stores({
    daily_costs: "date",
    messages:
      "id, sessionId, [sessionId+order], [sessionId+timestamp], [sessionId+status], order, timestamp, status",
    "provider-keys": "provider, updatedAt",
    publicMessages: null,
    publicSessions: null,
    repositories: "[owner+repo+ref], lastOpenedAt",
    session_leases: "sessionId, ownerTabId, heartbeatAt",
    session_runtime: "sessionId, phase, status, ownerTabId, lastProgressAt, updatedAt",
    sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
    settings: "key, updatedAt",
    shareOwners: null,
  });
}
