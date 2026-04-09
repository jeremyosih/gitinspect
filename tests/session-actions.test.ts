import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionData } from "@/types/storage";
import { createEmptyUsage } from "@/types/models";

const deleteSession = vi.fn(async () => {});
const getSetting = vi.fn();
const listProviderKeys = vi.fn();
const setSetting = vi.fn(async () => {});
const persistSessionSnapshot = vi.fn(async () => {});
const createSession = vi.fn();
const releaseSessionAndDrain = vi.fn(async () => {});

vi.mock("@gitinspect/db", () => ({
  deleteSession,
  getSetting,
  listProviderKeys,
  setSetting,
}));

vi.mock("@/sessions/session-service", () => ({
  createSession,
  persistSessionSnapshot,
}));

vi.mock("@/agent/runtime-client", () => ({
  runtimeClient: {
    releaseSessionAndDrain,
  },
}));

vi.mock("@/models/catalog", () => ({
  getCanonicalProvider: (providerGroup: string) => providerGroup,
  getConnectedProviders: () => [],
  getDefaultModelForGroup: () => ({
    id: "gpt-5.1-codex-mini",
  }),
  getDefaultProviderGroup: (provider: string) => provider,
  getPreferredProviderGroup: () => "openai-codex",
  getProviderGroups: () => ["fireworks-free", "openai-codex"],
  getVisibleProviderGroups: () => ["fireworks-free", "openai-codex"],
  hasModelForGroup: () => true,
  isProviderGroupId: (value: string) => value === "fireworks-free" || value === "openai-codex",
}));

function buildSession(id: string, overrides: Partial<SessionData> = {}): SessionData {
  const session = {
    cost: 0,
    createdAt: "2026-03-23T12:00:00.000Z",
    error: undefined,
    id,
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex" as SessionData["provider"],
    providerGroup: "openai-codex" as SessionData["providerGroup"],
    repoSource: undefined,
    sourceUrl: undefined,
    thinkingLevel: "medium" as SessionData["thinkingLevel"],
    title: "New chat",
    updatedAt: "2026-03-23T12:00:00.000Z",
    usage: createEmptyUsage(),
    ...overrides,
  };

  return session;
}

function buildRepoSource() {
  return {
    owner: "acme",
    ref: "dev",
    refOrigin: "explicit" as const,
    repo: "demo",
    resolvedRef: {
      apiRef: "heads/dev" as const,
      fullRef: "refs/heads/dev" as const,
      kind: "branch" as const,
      name: "dev",
    },
  };
}

describe("session-actions", () => {
  beforeEach(() => {
    createSession.mockReset();
    deleteSession.mockReset();
    getSetting.mockReset();
    listProviderKeys.mockReset();
    persistSessionSnapshot.mockReset();
    releaseSessionAndDrain.mockReset();
    setSetting.mockReset();
  });

  it("builds canonical session hrefs", async () => {
    const { buildSessionHref } = await import("@/sessions/session-actions");

    expect(buildSessionHref("session-1")).toBe("/chat/session-1");
  });

  it("creates empty chat sessions from provider defaults", async () => {
    const created = buildSession("session-new");
    createSession.mockReturnValue(created);
    getSetting.mockResolvedValue(undefined);
    listProviderKeys.mockResolvedValue([]);

    const { createSessionForChat } = await import("@/sessions/session-actions");
    const session = await createSessionForChat();

    expect(createSession).toHaveBeenCalledWith({
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      repoSource: undefined,
    });
    expect(persistSessionSnapshot).not.toHaveBeenCalled();
    expect(session.id).toBe("session-new");
  });

  it("creates repo sessions with the current repo context", async () => {
    const created = buildSession("session-repo", {
      repoSource: buildRepoSource(),
    });
    createSession.mockReturnValue(created);
    getSetting.mockResolvedValue(undefined);
    listProviderKeys.mockResolvedValue([]);

    const { createSessionForRepo } = await import("@/sessions/session-actions");
    const session = await createSessionForRepo({
      repoSource: buildRepoSource(),
      sourceUrl: "https://github.com/acme/demo/tree/dev",
    });

    expect(createSession).toHaveBeenCalledWith({
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      repoSource: buildRepoSource(),
      sourceUrl: "https://github.com/acme/demo/tree/dev",
    });
    expect(persistSessionSnapshot).not.toHaveBeenCalled();
    expect(session.repoSource?.ref).toBe("dev");
  });

  it("persists last-used session settings", async () => {
    const { persistLastUsedSessionSettings } = await import("@/sessions/session-actions");

    await persistLastUsedSessionSettings({
      model: "gpt-5.1-codex-mini",
      provider: "openai-codex",
      providerGroup: "openai-codex",
    });

    expect(setSetting).toHaveBeenCalledWith("last-used-model", "gpt-5.1-codex-mini");
    expect(setSetting).toHaveBeenCalledWith("last-used-provider", "openai-codex");
    expect(setSetting).toHaveBeenCalledWith("last-used-provider-group", "openai-codex");
  });

  it("deletes the session and falls back to a sibling", async () => {
    const { deleteSessionAndResolveNext } = await import("@/sessions/session-actions");

    const sibling = buildSession("session-next");
    const result = await deleteSessionAndResolveNext({
      sessionId: "session-current",
      siblingSessions: [buildSession("session-current"), sibling],
    });

    expect(releaseSessionAndDrain).toHaveBeenCalledWith("session-current");
    expect(deleteSession).toHaveBeenCalledWith("session-current");
    expect(result).toEqual({
      nextSessionId: "session-next",
    });
  });

  it("clears the selection when no fallback session remains", async () => {
    const { deleteSessionAndResolveNext } = await import("@/sessions/session-actions");

    const result = await deleteSessionAndResolveNext({
      sessionId: "session-current",
      siblingSessions: [buildSession("session-current")],
    });

    expect(result).toEqual({
      nextSessionId: undefined,
    });
  });

  it("waits for release to drain before deleting a running session", async () => {
    let resolveRelease: (() => void) | undefined;
    releaseSessionAndDrain.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          resolveRelease = resolve;
        }),
    );

    const { deleteSessionAndResolveNext } = await import("@/sessions/session-actions");
    const deletePromise = deleteSessionAndResolveNext({
      sessionId: "session-current",
      siblingSessions: [buildSession("session-current")],
    });

    await Promise.resolve();
    expect(deleteSession).not.toHaveBeenCalled();

    resolveRelease?.();
    await deletePromise;

    expect(deleteSession).toHaveBeenCalledWith("session-current");
  });
});
