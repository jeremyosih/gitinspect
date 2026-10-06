import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { FauxResponseStep, Message } from "@earendil-works/pi-ai";
import {
  deleteAllLocalData,
  getSessionMessages,
  getSessionRuntime,
  getSession,
  putSession,
} from "@gitinspect/db";
import type { SessionData } from "@gitinspect/db";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  models: undefined as unknown,
  readFile: vi.fn(),
}));
vi.mock("@/auth/resolve-api-key", () => ({ resolveProviderAuthForProvider: mocks.auth }));
vi.mock("@/agent/provider-models", async () => {
  const Pi = await import("effect-pi-durable");
  const { Effect, Layer } = await import("effect");

  return {
    ProviderModels: Layer.effect(
      Pi.Models,
      Effect.sync(() => mocks.models as never),
    ),
  };
});
vi.mock("@/repo/repo-runtime", async (original) => ({
  ...(await original<typeof import("@/repo/repo-runtime")>()),
  createOptionalRepoRuntime: (source: unknown) =>
    source
      ? {
          fs: {
            readFile: mocks.readFile,
            resolvePath: (_cwd: string, path: string) => `/${path}`,
            snapshotCommit: async () => "pinned-sha",
          },
          getCwd: () => "/",
          getWarnings: () => [],
          source,
        }
      : undefined,
}));

const repoSource = {
  owner: "acme",
  repo: "demo",
  ref: "main",
  refOrigin: "default" as const,
  resolvedRef: { kind: "branch" as const, name: "main" },
};
function session(overrides: Partial<SessionData> = {}): SessionData {
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
    ...overrides,
  };
}
function input(text = "hello", id = "user-1", overrides: Partial<SessionData> = {}) {
  return {
    ownerTabId: "tab-1",
    session: session(overrides),
    turn: {
      turnId: `turn-${id}`,
      userMessage: { id, role: "user" as const, content: text, timestamp: Date.now() },
    },
  };
}
function textOf(message: Message): string {
  return typeof message.content === "string"
    ? message.content
    : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

let worker: typeof import("@/agent/runtime-worker");
let respond: (responses: FauxResponseStep[]) => void;
/** Pace the scripted answer so a turn can be observed and stopped while it streams. */
function useModels(tokensPerSecond?: number) {
  const faux = fauxProvider({
    provider: "openai-codex",
    models: [{ id: "gpt-5.4" }],
    tokensPerSecond,
  });
  const models = createModels();
  models.setProvider(faux.provider);
  mocks.models = models;
  respond = faux.setResponses;
  return faux;
}

beforeEach(async () => {
  vi.clearAllMocks();
  await deleteAllLocalData();
  mocks.auth.mockResolvedValue({
    apiKey: "test",
    isOAuth: false,
    provider: "openai-codex",
    storedValue: "test",
  });
  mocks.readFile.mockResolvedValue("# Demo");
  useModels();
  worker = await import("@/agent/runtime-worker");
});
afterEach(async () => {
  await worker.disposeSession("session-1");
});

describe("pi runtime worker", () => {
  it("persists the user immediately and commits the streamed answer with completion", async () => {
    respond([fauxAssistantMessage("Hello world")]);
    await worker.startTurn(input());
    expect(await getSessionMessages("session-1")).toEqual([
      expect.objectContaining({ id: "user-1", order: 0 }),
    ]);
    expect(await worker.waitForTurn("session-1")).toEqual({
      sessionId: "session-1",
      status: "completed",
    });
    expect((await getSessionMessages("session-1"))[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Hello world" }],
      provider: "openai-codex",
      model: "gpt-5.4",
      stopReason: "stop",
      status: "completed",
    });
    expect((await getSessionMessages("session-1"))[1]).toHaveProperty("usage.output");
    expect(await getSessionRuntime("session-1")).toMatchObject({
      phase: "idle",
      status: "completed",
      streamMessage: undefined,
    });
    expect(await getSession("session-1")).toMatchObject({ isStreaming: false, messageCount: 2 });
  });
  it("shows the answer while it streams", async () => {
    useModels(40);
    respond([fauxAssistantMessage("word ".repeat(40))]);
    await worker.startTurn(input());
    await vi.waitFor(async () => {
      const draft = (await getSessionRuntime("session-1"))?.streamMessage;
      expect(draft?.content[0]).toMatchObject({ type: "text" });
      expect(draft?.content[0]).not.toEqual({ type: "text", text: "word ".repeat(40) });
    });
    await worker.abortTurn("session-1");
    await worker.waitForTurn("session-1");
  });
  it("stops the run on abort and keeps the interrupted draft out of the transcript", async () => {
    useModels(40);
    respond([fauxAssistantMessage("word ".repeat(200))]);
    await worker.startTurn(input());
    await vi.waitFor(async () =>
      expect((await getSessionRuntime("session-1"))?.streamMessage).toBeDefined(),
    );
    await worker.abortTurn("session-1");
    expect(await worker.waitForTurn("session-1")).toEqual({
      sessionId: "session-1",
      status: "aborted",
      lastError: undefined,
    });
    const runtime = await getSessionRuntime("session-1");
    expect(runtime).toMatchObject({
      phase: "interrupted",
      status: "aborted",
      streamMessage: { stopReason: "aborted" },
    });
    expect(runtime!.streamMessage!.content[0]).toMatchObject({ type: "text" });
    expect((await getSessionMessages("session-1")).map((row) => row.role)).toEqual(["user"]);
  });
  it("runs repository tools and links their results to the assistant row", async () => {
    respond([
      fauxAssistantMessage(
        [fauxText("Reading"), fauxToolCall("read", { path: "README.md" }, { id: "call-1" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Done"),
    ]);
    await worker.startTurn(input("hello", "user-1", { repoSource }));
    expect(await worker.waitForTurn("session-1")).toMatchObject({ status: "completed" });
    const rows = await getSessionMessages("session-1");
    expect(rows.map((row) => row.role)).toEqual(["user", "assistant", "toolResult", "assistant"]);
    expect(rows.map((row) => row.order)).toEqual([0, 1, 2, 3]);
    expect(rows[1]).toMatchObject({ stopReason: "toolUse" });
    expect(rows[2]).toMatchObject({
      parentAssistantId: rows[1]!.id,
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text: "# Demo" }],
      details: { path: "README.md", resolvedPath: "/README.md" },
      isError: false,
    });
    expect(mocks.readFile).toHaveBeenCalledWith("/README.md", expect.anything());
    expect((await getSessionRuntime("session-1"))?.repoSnapshot?.sha).toBe("pinned-sha");
  });
  it("returns a failed tool call to the model as that call's result", async () => {
    mocks.readFile.mockRejectedValue(new Error("No such file or directory"));
    respond([
      fauxAssistantMessage(fauxToolCall("read", { path: "missing.ts" }, { id: "call-1" }), {
        stopReason: "toolUse",
      }),
      (context) =>
        fauxAssistantMessage(
          `Saw: ${textOf(context.messages.findLast((m) => m.role === "toolResult")!)}`,
        ),
    ]);
    await worker.startTurn(input("hello", "user-1", { repoSource }));
    expect(await worker.waitForTurn("session-1")).toMatchObject({ status: "completed" });
    const rows = await getSessionMessages("session-1");
    // The tool's repository notice follows the assistant message that called it.
    expect(rows.map((row) => row.role)).toEqual([
      "user",
      "assistant",
      "system",
      "toolResult",
      "assistant",
    ]);
    expect(rows[3]).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "No such file or directory" }],
    });
    expect(rows[4]).toMatchObject({
      content: [{ type: "text", text: "Saw: No such file or directory" }],
    });
  });
  it("starts a new conversation from the persisted transcript", async () => {
    respond([fauxAssistantMessage("First answer")]);
    await worker.startTurn(input("first question"));
    await worker.waitForTurn("session-1");
    // The same harness keeps its conversation across turns.
    respond([
      (context) =>
        fauxAssistantMessage(
          context.messages
            .filter((message) => message.role !== "system")
            .map(textOf)
            .join(" | "),
        ),
    ]);
    await worker.startTurn(input("second question", "user-2"));
    await worker.waitForTurn("session-1");
    expect((await getSessionMessages("session-1"))[3]).toMatchObject({
      content: [{ type: "text", text: "first question | First answer | second question" }],
    });

    // A new worker has only the transcript.
    await worker.disposeSession("session-1");
    const seen: Message[] = [];
    respond([
      (context) => {
        seen.push(...context.messages);
        return fauxAssistantMessage("Third answer");
      },
    ]);
    await worker.startTurn(input("third question", "user-3"));
    expect(await worker.waitForTurn("session-1")).toMatchObject({ status: "completed" });
    expect(seen.filter((message) => message.role !== "system").map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(seen.filter((message) => message.role === "user").map(textOf)).toEqual([
      "first question",
      "second question",
      "third question",
    ]);
    expect((await getSessionMessages("session-1")).map((row) => row.order)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });
  it("records a provider failure as the turn's error and recovers on the next turn", async () => {
    respond([fauxAssistantMessage("", { stopReason: "error", errorMessage: "401 invalid key" })]);
    await worker.startTurn(input());
    expect(await worker.waitForTurn("session-1")).toEqual({
      sessionId: "session-1",
      status: "error",
      lastError: "401 invalid key",
    });
    expect(await getSessionRuntime("session-1")).toMatchObject({
      phase: "interrupted",
      status: "error",
      lastError: "401 invalid key",
    });
    expect((await getSessionMessages("session-1")).map((row) => row.role)).toEqual([
      "user",
      "system",
    ]);

    respond([fauxAssistantMessage("Recovered")]);
    await worker.startTurn(input("again", "user-2"));
    expect(await worker.waitForTurn("session-1")).toMatchObject({ status: "completed" });
    expect((await getSessionMessages("session-1")).at(-1)).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Recovered" }],
    });
  });
  it("fails clearly without stored credentials", async () => {
    mocks.auth.mockResolvedValue(undefined);
    await worker.startTurn(input());
    expect(await worker.waitForTurn("session-1")).toMatchObject({
      status: "error",
      lastError: "No credentials stored for openai-codex",
    });
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
  it("serializes notices with a turn without duplicate transcript order", async () => {
    let answer!: () => void;
    const noticed = new Promise<void>((resolve) => (answer = resolve));
    respond([() => noticed.then(() => fauxAssistantMessage("Done"))]);
    await Promise.all([
      worker.startTurn(input()),
      worker.appendSessionNotice({ sessionId: "session-1", error: "Notice" }),
    ]);
    answer();
    await worker.waitForTurn("session-1");
    const rows = await getSessionMessages("session-1");
    expect(rows.map((row) => row.order)).toEqual([0, 1, 2]);
    expect(rows[1]!.role).toBe("system");
  });
});
