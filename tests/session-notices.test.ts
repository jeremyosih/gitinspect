import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionData } from "@/types/storage";
import { createEmptyUsage } from "@/types/models";

const deleteSessionLease = vi.fn(async (_sessionId: string): Promise<void> => {});
const loadSessionLeaseState = vi.fn(async () => ({ kind: "none" as const }));
const appendSessionNoticeCommand = vi.fn(async (_input: unknown): Promise<void> => {});
const reconcileInterruptedSessionCommand = vi.fn(async (_input: unknown): Promise<void> => {});
const loadSessionViewModel = vi.fn(async () => ({
  displayMessages: [],
  hasPartialAssistantText: false,
  isStreaming: false,
  runtime: undefined,
  session: createSession(),
  transcriptMessages: [],
}));
const deriveActiveSessionViewState = vi.fn(() => ({ kind: "ready" as const }));
const deriveRecoveryIntent = vi.fn(() => "none" as const);
const deriveRecoverySkipReason = vi.fn(() => "not-streaming" as const);

vi.mock("@/db/schema", () => ({
  deleteSessionLease,
}));

vi.mock("@/db/session-leases", () => ({
  loadSessionLeaseState,
}));

vi.mock("@/agent/runtime-worker-client", () => ({
  getRuntimeWorker: () => ({
    appendSessionNotice: appendSessionNoticeCommand,
    reconcileInterruptedSession: reconcileInterruptedSessionCommand,
  }),
  getRuntimeWorkerIfAvailable: () => ({
    appendSessionNotice: appendSessionNoticeCommand,
    reconcileInterruptedSession: reconcileInterruptedSessionCommand,
  }),
}));

vi.mock("@/sessions/session-view-model", () => ({
  loadSessionViewModel,
}));

vi.mock("@/sessions/session-view-state", () => ({
  deriveActiveSessionViewState,
  deriveRecoveryIntent,
  deriveRecoverySkipReason,
}));

function createSession(): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id: "session-1",
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.1-codex-mini",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    repoSource: undefined,
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  };
}

describe("session-notices", () => {
  beforeEach(() => {
    vi.resetModules();
    deleteSessionLease.mockClear();
    loadSessionLeaseState.mockClear();
    appendSessionNoticeCommand.mockClear();
    reconcileInterruptedSessionCommand.mockClear();
    loadSessionViewModel.mockClear();
    deriveActiveSessionViewState.mockClear();
    deriveRecoveryIntent.mockClear();
    deriveRecoverySkipReason.mockClear();
    loadSessionLeaseState.mockResolvedValue({ kind: "none" });
    loadSessionViewModel.mockResolvedValue({
      displayMessages: [],
      hasPartialAssistantText: false,
      isStreaming: false,
      runtime: undefined,
      session: createSession(),
      transcriptMessages: [],
    });
    deriveActiveSessionViewState.mockReturnValue({ kind: "ready" });
    deriveRecoveryIntent.mockReturnValue("none");
    deriveRecoverySkipReason.mockReturnValue("not-streaming");
  });

  it("forwards persisted notices to the worker", async () => {
    const { appendSessionNotice } = await import("@/sessions/session-notices");

    await appendSessionNotice("session-1", new Error("boom"));

    expect(appendSessionNoticeCommand).toHaveBeenCalledWith({
      error: "boom",
      sessionId: "session-1",
    });
  });

  it("returns noop when recovery should not run", async () => {
    const { reconcileInterruptedSession } = await import("@/sessions/session-notices");

    const result = await reconcileInterruptedSession("session-1");

    expect(result).toEqual({
      kind: "noop",
      lastProgressAt: undefined,
      reason: "not-streaming",
    });
    expect(reconcileInterruptedSessionCommand).not.toHaveBeenCalled();
  });

  it("routes stale recovery through the worker and clears owned leases", async () => {
    loadSessionLeaseState.mockResolvedValue({ kind: "owned" });
    loadSessionViewModel.mockResolvedValue({
      displayMessages: [],
      hasPartialAssistantText: true,
      isStreaming: true,
      runtime: {
        lastProgressAt: "2026-03-24T12:01:00.000Z",
        phase: "running",
        sessionId: "session-1",
        status: "streaming",
        updatedAt: "2026-03-24T12:01:00.000Z",
      },
      session: {
        ...createSession(),
        isStreaming: true,
      },
      transcriptMessages: [],
    });
    deriveActiveSessionViewState.mockReturnValue({ kind: "recovering" });
    deriveRecoveryIntent.mockReturnValue("run-now");

    const { reconcileInterruptedSession } = await import("@/sessions/session-notices");
    const result = await reconcileInterruptedSession("session-1");

    expect(result).toEqual({
      kind: "reconciled",
      lastProgressAt: "2026-03-24T12:01:00.000Z",
    });
    expect(reconcileInterruptedSessionCommand).toHaveBeenCalledWith({
      sessionId: "session-1",
    });
    expect(deleteSessionLease).toHaveBeenCalledWith("session-1");
  });
});
