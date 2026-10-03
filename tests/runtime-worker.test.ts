import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  db,
  deleteAllLocalData,
  getSessionMessages,
  getSessionRuntime,
  getSession,
  putSession,
} from "@gitinspect/db";
import type { SessionData } from "@gitinspect/db";
import type { FxEvent, FxOptions, FxTurn } from "../packages/runtime/src/agent/fx-types";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  close: vi.fn(),
  checkpoint: vi.fn(),
  supports: vi.fn(() => true),
  auth: vi.fn(),
  repoError: undefined as ((error: unknown) => Promise<void>) | undefined,
}));
vi.mock("libfx/browser", () => ({ createFxAgent: mocks.create, supportsJspi: mocks.supports }));
vi.mock("@/auth/resolve-api-key", () => ({ resolveProviderAuthForProvider: mocks.auth }));
vi.mock("@/agent/provider-stream", () => ({
  createProviderModel: async () => ({}),
  createFxFetch: () => fetch,
}));
vi.mock("@/repo/repo-runtime", () => ({
  createOptionalRepoRuntime: (source: unknown) =>
    source ? { fs: { snapshotCommit: async () => "pinned-sha" } } : undefined,
}));
vi.mock("@/tools", () => ({
  createRepoTools: (_runtime: unknown, options: any) => {
    mocks.repoError = options.onRepoError;
    return { agentTools: [] };
  },
}));

function session(): SessionData {
  return {
    id: "session-1",
    title: "",
    preview: "",
    cost: 0,
    messageCount: 0,
    isStreaming: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model: "gpt-5.4",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    thinkingLevel: "medium",
  };
}
function input(text = "hello", id = "user-1") {
  return {
    ownerTabId: "tab-1",
    session: session(),
    turn: {
      turnId: `turn-${id}`,
      userMessage: { id, role: "user" as const, content: text, timestamp: Date.now() },
    },
  };
}
function deferredTurn() {
  const events: FxEvent[] = [];
  let finished = false;
  let wake: () => void = () => {};
  let resolveResult!: (result: any) => void;
  const result = new Promise<any>((resolve) => (resolveResult = resolve));
  const turn: FxTurn = {
    result,
    cancel: vi.fn(() => finish("cancelled")),
    async *[Symbol.asyncIterator]() {
      while (!finished || events.length) {
        if (events.length) yield events.shift()!;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
  function push(event: FxEvent) {
    events.push(event);
    wake();
  }
  function finish(stopReason = "end_turn") {
    finished = true;
    resolveResult({ stopReason, usage: { inputTokens: 5, outputTokens: 2 } });
    wake();
  }
  return { turn, push, finish };
}
let turns: ReturnType<typeof deferredTurn>[] = [];
let worker: typeof import("@/agent/runtime-worker");
async function started() {
  await vi.waitFor(() => expect(mocks.create).toHaveBeenCalled());
  await vi.waitFor(() => expect(turns.length).toBeGreaterThan(0));
  return turns.at(-1)!;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await deleteAllLocalData();
  turns = [];
  mocks.supports.mockReturnValue(true);
  mocks.auth.mockResolvedValue({
    apiKey: "test",
    isOAuth: false,
    provider: "openai-codex",
    storedValue: "test",
  });
  mocks.checkpoint.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.close.mockResolvedValue(undefined);
  mocks.create.mockImplementation(async (_options: FxOptions) => ({
    prompt: () => {
      const turn = deferredTurn();
      turns.push(turn);
      return turn.turn;
    },
    checkpoint: mocks.checkpoint,
    close: mocks.close,
  }));
  worker = await import("@/agent/runtime-worker");
});
afterEach(async () => {
  await worker.disposeSession("session-1");
});

describe("fx runtime worker", () => {
  it("persists the user immediately, streams, and commits a checkpoint with completion", async () => {
    await worker.startTurn(input());
    expect(await getSessionMessages("session-1")).toEqual([
      expect.objectContaining({ id: "user-1", order: 0 }),
    ]);
    const turn = await started();
    turn.push({ type: "text_delta", delta: "Hello" });
    await vi.waitFor(async () =>
      expect((await getSessionRuntime("session-1"))?.streamMessage?.content).toEqual([
        { type: "text", text: "Hello" },
      ]),
    );
    turn.push({ type: "text_delta", delta: " world" });
    turn.finish();
    expect(await worker.waitForTurn("session-1")).toEqual({
      sessionId: "session-1",
      status: "completed",
    });
    expect((await getSessionMessages("session-1"))[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Hello world" }],
      usage: { input: 5, output: 2 },
    });
    expect(Array.from((await db.fxCheckpoints.get("session-1"))!.bytes)).toEqual([1, 2, 3]);
    expect(await getSessionRuntime("session-1")).toMatchObject({
      phase: "idle",
      streamMessage: undefined,
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("cancels fx, keeps the interrupted draft, and never saves an aborted checkpoint", async () => {
    await worker.startTurn(input());
    const turn = await started();
    turn.push({ type: "text_delta", delta: "Partial" });
    await vi.waitFor(async () =>
      expect((await getSessionRuntime("session-1"))?.streamMessage).toBeDefined(),
    );
    await worker.abortTurn("session-1");
    expect(await worker.waitForTurn("session-1")).toMatchObject({ status: "aborted" });
    expect(turn.turn.cancel).toHaveBeenCalled();
    expect(await db.fxCheckpoints.get("session-1")).toBeUndefined();
    expect(await getSessionRuntime("session-1")).toMatchObject({
      phase: "interrupted",
      streamMessage: { content: [{ type: "text", text: "Partial" }] },
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it("links fx tool results to their assistant row", async () => {
    await worker.startTurn(input());
    const turn = await started();
    turn.push({ type: "tool_start", id: "call-1", name: "read", input: { path: "README.md" } });
    turn.push({ type: "tool_end", id: "call-1", name: "read", content: "README", isError: false });
    turn.push({ type: "text_delta", delta: "Done" });
    turn.finish();
    await worker.waitForTurn("session-1");
    const rows = await getSessionMessages("session-1");
    expect(rows[2]).toMatchObject({
      role: "toolResult",
      parentAssistantId: rows[1]!.id,
      toolCallId: "call-1",
    });
    expect(rows.map((row) => row.order)).toEqual([0, 1, 2, 3]);
  });
  it("restores only checkpoints matching the persisted transcript", async () => {
    await worker.startTurn(input());
    let turn = await started();
    turn.push({ type: "text_delta", delta: "First" });
    turn.finish();
    await worker.waitForTurn("session-1");
    await worker.disposeSession("session-1");
    await worker.startTurn(input("continue", "user-2"));
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(Array.from(mocks.create.mock.calls[1]![0].checkpoint)).toEqual([1, 2, 3]);
    turn = turns.at(-1)!;
    turn.finish();
    await worker.waitForTurn("session-1");
    await worker.disposeSession("session-1");
    const row = (await getSessionMessages("session-1"))[1]!;
    await db.messages.put({ ...row, content: [{ type: "text", text: "edited" }] } as any);
    await worker.startTurn(input("again", "user-3"));
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(3));
    expect(mocks.create.mock.calls[2]![0].checkpoint).toBeUndefined();
    turns.at(-1)!.finish();
    await worker.waitForTurn("session-1");
  });
  it("closes fx and records an error if checkpoint persistence fails", async () => {
    mocks.checkpoint.mockRejectedValueOnce(new Error("Checkpoint failed"));
    await worker.startTurn(input());
    const turn = await started();
    turn.push({ type: "text_delta", delta: "Done" });
    turn.finish();
    expect(await worker.waitForTurn("session-1")).toMatchObject({
      status: "error",
      lastError: "Checkpoint failed",
    });
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(await db.fxCheckpoints.get("session-1")).toBeUndefined();
  });
  it("keeps model and thinking settings in IndexedDB", async () => {
    await putSession(session());
    await worker.setModelSelection({
      sessionId: "session-1",
      providerGroup: "openai",
      modelId: "gpt-5.4-mini",
    });
    await worker.setThinkingLevel({ sessionId: "session-1", thinkingLevel: "high" });
    expect(await getSession("session-1")).toMatchObject({
      provider: "openai",
      model: "gpt-5.4-mini",
      thinkingLevel: "high",
    });
  });
  it("reports a clear browser capability error without invoking fx", async () => {
    mocks.supports.mockReturnValue(false);
    await worker.startTurn(input());
    expect(await worker.waitForTurn("session-1")).toMatchObject({
      status: "error",
      lastError: expect.stringContaining("JSPI"),
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("serializes notices with a turn without duplicate transcript order", async () => {
    await Promise.all([
      worker.startTurn(input()),
      worker.appendSessionNotice({ sessionId: "session-1", error: "Notice" }),
    ]);
    const turn = await started();
    turn.push({ type: "text_delta", delta: "Done" });
    turn.finish();
    await worker.waitForTurn("session-1");
    const rows = await getSessionMessages("session-1");
    expect(rows.map((row) => row.order)).toEqual([0, 1, 2]);
    expect(rows[1]!.role).toBe("system");
  });
});
