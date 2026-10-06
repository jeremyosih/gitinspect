import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { AppDb } from "@gitinspect/db";
import { createEmptyUsage } from "@/types/models";
import type {
  MessageRow,
  RepoRefOrigin,
  ResolvedRepoRef,
  SessionData,
  SessionRuntimeRow,
} from "@/types/storage";
import {
  getCostsByModelFromAggregates,
  getCostsByProviderFromAggregates,
  getTotalCostFromAggregates,
  mergeDailyCostAggregate,
} from "@gitinspect/db";

type LegacyRepositoryRow = {
  lastOpenedAt: string;
  owner: string;
  ref: string;
  refOrigin?: RepoRefOrigin;
  repo: string;
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
  phase?: SessionRuntimeRow["phase"];
};

type LegacyToolResultRow = Omit<
  Extract<MessageRow, { role: "toolResult" }>,
  "parentAssistantId"
> & {
  order?: number;
  parentAssistantId?: string;
};

function defineLegacySchema(db: Dexie): void {
  db.version(3).stores({
    daily_costs: "date",
    messages: "id, sessionId, [sessionId+timestamp], [sessionId+status], timestamp, status",
    "provider-keys": "provider, updatedAt",
    repositories: "[owner+repo+ref], lastOpenedAt",
    session_leases: "sessionId, ownerTabId, heartbeatAt",
    session_runtime: "sessionId, status, ownerTabId, lastProgressAt, updatedAt",
    sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
    settings: "key, updatedAt",
  });
}

function defineLegacyShareSchema(db: Dexie): void {
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
}

function defineLegacyCurrentSchema(db: Dexie): void {
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

function buildLegacySession(id: string, repoSource?: LegacySessionRepoSource): LegacySessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id,
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    repoSource,
    thinkingLevel: "medium",
    title: id,
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  };
}

function buildCurrentSession(id: string, overrides: Partial<SessionData> = {}): SessionData {
  return {
    ...buildLegacySession(id),
    ...overrides,
  };
}

function buildUserRow(params: {
  content?: string;
  id: string;
  order: number;
  sessionId: string;
  timestamp: number;
}): MessageRow {
  return {
    content: params.content ?? "hello",
    id: params.id,
    order: params.order,
    role: "user",
    sessionId: params.sessionId,
    status: "completed",
    timestamp: params.timestamp,
  };
}

function buildAssistantRow(params: {
  content?: Extract<MessageRow, { role: "assistant" }>["content"];
  id: string;
  order: number;
  sessionId: string;
  status?: MessageRow["status"];
  timestamp: number;
}): MessageRow {
  return {
    api: "openai-responses",
    content: params.content ?? [{ text: "assistant", type: "text" }],
    id: params.id,
    model: "gpt-5.1-codex-mini",
    order: params.order,
    provider: "openai-codex",
    role: "assistant",
    sessionId: params.sessionId,
    status: params.status ?? "completed",
    stopReason: "stop",
    timestamp: params.timestamp,
    usage: createEmptyUsage(),
  };
}

function buildToolResultRow(params: {
  id: string;
  order: number;
  parentAssistantId?: string;
  sessionId: string;
  timestamp: number;
  toolCallId: string;
}): LegacyToolResultRow {
  return {
    content: [{ text: "ok", type: "text" }],
    id: params.id,
    isError: false,
    order: params.order,
    parentAssistantId: params.parentAssistantId,
    role: "toolResult",
    sessionId: params.sessionId,
    status: "completed",
    timestamp: params.timestamp,
    toolCallId: params.toolCallId,
  };
}

async function openMigratedCurrentSchemaDb(seed: {
  messages?: Array<LegacyMessageRow | MessageRow>;
  runtimes?: LegacySessionRuntimeRow[];
  sessions: SessionData[];
}): Promise<{ migratedDb: AppDb; name: string }> {
  const name = `gitinspect-session-state-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const legacyDb = new Dexie(name);

  defineLegacyCurrentSchema(legacyDb);
  await legacyDb.open();

  if (seed.sessions.length > 0) {
    await legacyDb.table<SessionData, string>("sessions").bulkPut(seed.sessions);
  }

  if ((seed.messages ?? []).length > 0) {
    await legacyDb.table<LegacyMessageRow, string>("messages").bulkPut(seed.messages ?? []);
  }

  if ((seed.runtimes ?? []).length > 0) {
    await legacyDb
      .table<LegacySessionRuntimeRow, string>("session_runtime")
      .bulkPut(seed.runtimes ?? []);
  }

  legacyDb.close();

  const migratedDb = new AppDb(name);
  await migratedDb.open();

  return {
    migratedDb,
    name,
  };
}

async function getSortedMessages(migratedDb: AppDb, sessionId: string): Promise<MessageRow[]> {
  return (await migratedDb.messages.where("sessionId").equals(sessionId).toArray()).sort(
    (left, right) => left.order - right.order,
  );
}

describe("db schema helpers", () => {
  it("merges daily cost aggregates by provider and model", () => {
    const usage = createEmptyUsage();
    usage.cost.total = 1.25;

    expect(
      mergeDailyCostAggregate(undefined, usage, "openai-codex", "gpt-5.1", "2026-03-23"),
    ).toEqual({
      byProvider: {
        "openai-codex": {
          "gpt-5.1": 1.25,
        },
      },
      date: "2026-03-23",
      total: 1.25,
    });
  });

  it("exposes total, provider, and model cost queries", () => {
    const dailyCosts = [
      {
        byProvider: {
          anthropic: {
            "claude-sonnet-4-6": 2,
          },
          "openai-codex": {
            "gpt-5.1": 3,
          },
        },
        date: "2026-03-23",
        total: 5,
      },
    ];

    expect(getTotalCostFromAggregates(dailyCosts)).toBe(5);
    expect(getCostsByProviderFromAggregates(dailyCosts)).toMatchObject({
      anthropic: 2,
      "openai-codex": 3,
    });
    expect(getCostsByModelFromAggregates(dailyCosts)).toMatchObject({
      "claude-sonnet-4-6": 2,
      "gpt-5.1": 3,
    });
  });

  it("migrates repository rows missing refOrigin", async () => {
    const name = `gitinspect-migration-${Date.now()}`;
    const legacyDb = new Dexie(name);

    defineLegacySchema(legacyDb);

    await legacyDb.open();
    await legacyDb.table<LegacyRepositoryRow, [string, string, string]>("repositories").put({
      lastOpenedAt: "2026-03-24T12:00:00.000Z",
      owner: "acme",
      ref: "main",
      repo: "demo",
    });
    legacyDb.close();

    const migratedDb = new AppDb(name);
    await migratedDb.open();

    expect(await migratedDb.repositories.toArray()).toEqual([
      {
        lastOpenedAt: "2026-03-24T12:00:00.000Z",
        owner: "acme",
        ref: "main",
        refOrigin: "explicit",
        repo: "demo",
      },
    ]);

    migratedDb.close();
    await Dexie.delete(name);
  });

  it("migrates deterministic legacy session repo sources and clears ambiguous refs", async () => {
    const name = `gitinspect-session-migration-${Date.now()}`;
    const legacyDb = new Dexie(name);

    defineLegacySchema(legacyDb);

    await legacyDb.open();
    const sessionsTable = legacyDb.table<LegacySessionData, string>("sessions");
    const commitSha = "0123456789abcdef0123456789abcdef01234567";

    await sessionsTable.bulkPut([
      buildLegacySession("session-resolved", {
        owner: "acme",
        ref: "stale-value",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          apiRef: "heads/main",
          fullRef: "refs/heads/main",
          kind: "branch",
          name: "main",
        },
      }),
      buildLegacySession("session-commit", {
        owner: "acme",
        ref: commitSha,
        repo: "demo",
      }),
      buildLegacySession("session-branch", {
        owner: "acme",
        ref: "refs/heads/feature/foo",
        repo: "demo",
      }),
      buildLegacySession("session-tag", {
        owner: "acme",
        ref: "tags/v1.2.3",
        repo: "demo",
      }),
      buildLegacySession("session-ambiguous", {
        owner: "acme",
        ref: "main",
        repo: "demo",
      }),
    ]);
    legacyDb.close();

    const migratedDb = new AppDb(name);
    await migratedDb.open();

    expect(await migratedDb.sessions.get("session-resolved")).toMatchObject({
      repoSource: {
        owner: "acme",
        ref: "main",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          apiRef: "heads/main",
          fullRef: "refs/heads/main",
          kind: "branch",
          name: "main",
        },
      },
    });
    expect(await migratedDb.sessions.get("session-commit")).toMatchObject({
      repoSource: {
        owner: "acme",
        ref: commitSha,
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          kind: "commit",
          sha: commitSha,
        },
      },
    });
    expect(await migratedDb.sessions.get("session-branch")).toMatchObject({
      repoSource: {
        owner: "acme",
        ref: "feature/foo",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          apiRef: "heads/feature/foo",
          fullRef: "refs/heads/feature/foo",
          kind: "branch",
          name: "feature/foo",
        },
      },
    });
    expect(await migratedDb.sessions.get("session-tag")).toMatchObject({
      repoSource: {
        owner: "acme",
        ref: "v1.2.3",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          apiRef: "tags/v1.2.3",
          fullRef: "refs/tags/v1.2.3",
          kind: "tag",
          name: "v1.2.3",
        },
      },
    });
    expect(await migratedDb.sessions.get("session-ambiguous")).toMatchObject({
      repoSource: undefined,
    });

    migratedDb.close();
    await Dexie.delete(name);
  });

  it("migrates transcript streaming rows into interrupted runtime state", async () => {
    const session = buildCurrentSession("session-streaming", {
      isStreaming: true,
      messageCount: 99,
      preview: "stale preview",
      title: "stale title",
    });
    const { migratedDb, name } = await openMigratedCurrentSchemaDb({
      messages: [
        buildUserRow({ id: "user-1", order: 7, sessionId: session.id, timestamp: 1 }),
        buildAssistantRow({
          content: [{ text: "partial", type: "text" }],
          id: "assistant-stream",
          order: 11,
          sessionId: session.id,
          status: "streaming",
          timestamp: 2,
        }),
      ],
      sessions: [session],
    });

    try {
      expect(await getSortedMessages(migratedDb, session.id)).toEqual([
        expect.objectContaining({ id: "user-1", order: 0, role: "user" }),
      ]);
      expect(await migratedDb.sessionRuntime.get(session.id)).toMatchObject({
        phase: "interrupted",
        status: "interrupted",
        streamMessage: expect.objectContaining({
          content: [{ text: "partial", type: "text" }],
          id: "assistant-stream",
        }),
      });
      expect(await migratedDb.sessions.get(session.id)).toMatchObject({
        isStreaming: false,
        messageCount: 1,
        preview: "hello",
        title: "hello",
      });
    } finally {
      migratedDb.close();
      await Dexie.delete(name);
    }
  });

  it("attaches a recovered draft to an existing runtime row that lacks streamMessage", async () => {
    const session = buildCurrentSession("session-runtime-attach");
    const runtime: LegacySessionRuntimeRow = {
      lastError: "Stream interrupted. The runtime stopped before completion.",
      lastProgressAt: "2026-03-24T12:05:00.000Z",
      pendingToolCallOwners: {},
      phase: "interrupted",
      sessionId: session.id,
      status: "interrupted",
      updatedAt: "2026-03-24T12:05:00.000Z",
    };
    const { migratedDb, name } = await openMigratedCurrentSchemaDb({
      messages: [
        buildUserRow({ id: "user-1", order: 0, sessionId: session.id, timestamp: 1 }),
        buildAssistantRow({
          content: [{ text: "late draft", type: "text" }],
          id: "assistant-stream",
          order: 1,
          sessionId: session.id,
          status: "streaming",
          timestamp: 2,
        }),
      ],
      runtimes: [runtime],
      sessions: [session],
    });

    try {
      expect(await getSortedMessages(migratedDb, session.id)).toEqual([
        expect.objectContaining({ id: "user-1", order: 0 }),
      ]);
      expect(await migratedDb.sessionRuntime.get(session.id)).toEqual(
        expect.objectContaining({
          phase: "interrupted",
          status: "interrupted",
          streamMessage: expect.objectContaining({
            id: "assistant-stream",
            content: [{ text: "late draft", type: "text" }],
          }),
          updatedAt: runtime.updatedAt,
        }),
      );
    } finally {
      migratedDb.close();
      await Dexie.delete(name);
    }
  });

  it("persists tool-result relinking during migration", async () => {
    const session = buildCurrentSession("session-tool-link");
    const { migratedDb, name } = await openMigratedCurrentSchemaDb({
      messages: [
        buildUserRow({ id: "user-1", order: 4, sessionId: session.id, timestamp: 1 }),
        buildAssistantRow({
          content: [
            {
              arguments: { path: "." },
              id: "tool-1",
              name: "ls",
              type: "toolCall",
            },
          ],
          id: "assistant-1",
          order: 7,
          sessionId: session.id,
          timestamp: 2,
        }),
        buildToolResultRow({
          id: "tool-result-1",
          order: 9,
          sessionId: session.id,
          timestamp: 3,
          toolCallId: "tool-1",
        }),
      ],
      sessions: [session],
    });

    try {
      expect(await getSortedMessages(migratedDb, session.id)).toEqual([
        expect.objectContaining({ id: "user-1", order: 0 }),
        expect.objectContaining({ id: "assistant-1", order: 1 }),
        expect.objectContaining({
          id: "tool-result-1",
          order: 2,
          parentAssistantId: "assistant-1",
          role: "toolResult",
        }),
      ]);
    } finally {
      migratedDb.close();
      await Dexie.delete(name);
    }
  });

  it("drops orphan tool-result rows during migration", async () => {
    const session = buildCurrentSession("session-tool-orphan");
    const { migratedDb, name } = await openMigratedCurrentSchemaDb({
      messages: [
        buildUserRow({ id: "user-1", order: 1, sessionId: session.id, timestamp: 1 }),
        buildToolResultRow({
          id: "tool-result-orphan",
          order: 8,
          sessionId: session.id,
          timestamp: 2,
          toolCallId: "missing-tool-call",
        }),
      ],
      sessions: [session],
    });

    try {
      expect(await getSortedMessages(migratedDb, session.id)).toEqual([
        expect.objectContaining({ id: "user-1", order: 0 }),
      ]);
    } finally {
      migratedDb.close();
      await Dexie.delete(name);
    }
  });

  it("persists provider-group normalization during migration", async () => {
    const session = buildCurrentSession("session-provider-group", {
      model: "gpt-5.4",
      provider: "openai",
      providerGroup: undefined,
    });
    const { migratedDb, name } = await openMigratedCurrentSchemaDb({
      sessions: [session],
    });

    try {
      expect(await migratedDb.sessions.get(session.id)).toMatchObject({
        provider: "openai",
        providerGroup: "openai",
      });
    } finally {
      migratedDb.close();
      await Dexie.delete(name);
    }
  });

  it("keeps only the latest transcript streaming assistant row as the recovered draft", async () => {
    const session = buildCurrentSession("session-multi-stream", {
      isStreaming: true,
    });
    const { migratedDb, name } = await openMigratedCurrentSchemaDb({
      messages: [
        buildUserRow({ id: "user-1", order: 0, sessionId: session.id, timestamp: 1 }),
        buildAssistantRow({
          content: [{ text: "old draft", type: "text" }],
          id: "assistant-stream-old",
          order: 3,
          sessionId: session.id,
          status: "streaming",
          timestamp: 2,
        }),
        buildAssistantRow({
          content: [{ text: "new draft", type: "text" }],
          id: "assistant-stream-new",
          order: 5,
          sessionId: session.id,
          status: "streaming",
          timestamp: 3,
        }),
      ],
      sessions: [session],
    });

    try {
      expect(await getSortedMessages(migratedDb, session.id)).toEqual([
        expect.objectContaining({ id: "user-1", order: 0 }),
      ]);
      expect(await migratedDb.sessionRuntime.get(session.id)).toMatchObject({
        phase: "interrupted",
        status: "interrupted",
        streamMessage: expect.objectContaining({
          id: "assistant-stream-new",
          content: [{ text: "new draft", type: "text" }],
        }),
      });
    } finally {
      migratedDb.close();
      await Dexie.delete(name);
    }
  });

  it("removes obsolete cloud share and engine checkpoint tables", async () => {
    const name = `gitinspect-restored-share-schema-${Date.now()}`;
    const legacyDb = new Dexie(name);

    defineLegacyShareSchema(legacyDb);
    await legacyDb.open();
    legacyDb.close();

    const migratedDb = new AppDb(name);
    await migratedDb.open();

    const tableNames = migratedDb.tables.map((table) => table.name);
    expect(tableNames).not.toContain("fx_checkpoints");
    expect(tableNames).not.toContain("shareOwners");
    expect(tableNames).not.toContain("publicMessages");
    expect(tableNames).not.toContain("publicSessions");

    migratedDb.close();
    await Dexie.delete(name);
  });
});
