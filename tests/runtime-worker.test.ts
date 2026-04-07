import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { deleteAllLocalData, getSession, getSessionMessages, getSessionRuntime } from "@/db/schema";
import type { AssistantMessage } from "@/types/chat";
import type { SessionData } from "@/types/storage";
import { createEmptyUsage } from "@/types/models";
import { TEST_REPO_SOURCE } from "./repo-test-utils";

type MockAgentEvent =
  | {
      message: AssistantMessage;
      type: "message_end" | "message_start" | "message_update";
    }
  | {
      type: "tool_execution_end" | "tool_execution_start" | "tool_execution_update";
    }
  | {
      type: "agent_start" | "turn_start" | "turn_end";
    };

type MockAgentState = {
  error: string | undefined;
  isStreaming: boolean;
  messages: Array<Message>;
  model: {
    id: string;
    provider: string;
  };
  streamMessage: Message | null;
  thinkingLevel: "medium";
};

type Subscriber = (event: MockAgentEvent) => void;

let subscriber: Subscriber | undefined;
let resolvePrompt: (() => void) | undefined;
let onRepoError: ((error: unknown) => void | Promise<void>) | undefined;

const agentState: MockAgentState = {
  error: undefined,
  isStreaming: false,
  messages: [],
  model: {
    id: "gpt-5.4",
    provider: "openai-codex",
  },
  streamMessage: null,
  thinkingLevel: "medium",
};

const promptMock = vi.fn(async (_message: Message & { id: string }): Promise<void> => {});
const abortMock = vi.fn(() => {});
const setModelMock = vi.fn((_model: { id: string; provider: string }): void => {});
const setThinkingLevelMock = vi.fn((_thinkingLevel: "medium" | "off" | "high"): void => {});
const setToolsMock = vi.fn((_tools: Array<AgentTool>): void => {});

vi.mock("@/auth/resolve-api-key", () => ({
  resolveApiKeyForProvider: vi.fn(async () => undefined),
}));

vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: class {
    state = agentState;
    sessionId = "";

    subscribe(listener: Subscriber) {
      subscriber = listener;
      return () => {
        subscriber = undefined;
      };
    }

    prompt = promptMock;
    abort = abortMock;
    setModel = setModelMock;
    setThinkingLevel = setThinkingLevelMock;
    setTools = setToolsMock;
  },
}));

vi.mock("@/tools", () => ({
  createRepoTools: vi.fn(
    (
      _runtime: unknown,
      options?: {
        onRepoError?: (error: unknown) => void | Promise<void>;
      },
    ) => {
      onRepoError = options?.onRepoError;

      return {
        agentTools: [] as AgentTool[],
      };
    },
  ),
}));

function createSession(): SessionData {
  return {
    cost: 0,
    createdAt: "2026-03-24T12:00:00.000Z",
    error: undefined,
    id: "session-1",
    isStreaming: false,
    messageCount: 0,
    model: "gpt-5.4",
    preview: "",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    repoSource: {
      ...TEST_REPO_SOURCE,
      owner: "acme",
      repo: "demo",
    },
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  };
}

function createAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    api: "openai-responses",
    content: [{ text: "Done", type: "text" }],
    id: "assistant-1",
    model: "gpt-5.4",
    provider: "openai-codex",
    role: "assistant",
    stopReason: "stop",
    timestamp: 2,
    usage: createEmptyUsage(),
    ...overrides,
  };
}

function createTurn() {
  return {
    turnId: "turn-1",
    userMessage: {
      content: "hello",
      id: "user-1",
      role: "user" as const,
      timestamp: 1,
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe("runtime worker", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useRealTimers();
    await deleteAllLocalData();
    promptMock.mockReset();
    abortMock.mockReset();
    setModelMock.mockClear();
    setThinkingLevelMock.mockClear();
    setToolsMock.mockClear();
    subscriber = undefined;
    resolvePrompt = undefined;
    onRepoError = undefined;
    agentState.error = undefined;
    agentState.isStreaming = false;
    agentState.messages = [];
    agentState.streamMessage = null;
  });

  it("persists the user row immediately and coalesces runtime draft updates", async () => {
    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true;

      for (const text of ["A", "AB", "ABC"]) {
        const assistant = createAssistantMessage({
          content: [{ text, type: "text" }],
          id: "assistant-stream",
          stopReason: "toolUse",
        });
        agentState.streamMessage = assistant;
        subscriber?.({
          message: assistant,
          type: "message_update",
        });
      }

      await new Promise<void>((resolve) => {
        resolvePrompt = () => {
          const assistant = createAssistantMessage({
            content: [{ text: "Finished", type: "text" }],
            id: "assistant-final",
          });
          agentState.isStreaming = false;
          agentState.streamMessage = null;
          subscriber?.({
            message: assistant,
            type: "message_end",
          });
          resolve();
        };
      });
    });

    const worker = await import("@/agent/runtime-worker");

    await worker.startTurn({
      ownerTabId: "tab-1",
      session: createSession(),
      turn: createTurn(),
    });

    expect(await getSessionMessages("session-1")).toEqual([
      expect.objectContaining({
        id: "user-1",
        order: 0,
        role: "user",
      }),
    ]);

    await sleep(70);

    expect(await getSessionRuntime("session-1")).toMatchObject({
      ownerTabId: "tab-1",
      phase: "running",
      status: "streaming",
      streamMessage: expect.objectContaining({
        content: [{ text: "ABC", type: "text" }],
      }),
    });

    resolvePrompt?.();
    await flushMicrotasks();

    expect(await worker.waitForTurn("session-1")).toEqual({
      sessionId: "session-1",
      status: "completed",
    });
    expect(await getSessionMessages("session-1")).toEqual([
      expect.objectContaining({ id: "user-1", order: 0, role: "user" }),
      expect.objectContaining({ id: "assistant-final", order: 1, role: "assistant" }),
    ]);
    expect(await getSessionRuntime("session-1")).toMatchObject({
      phase: "idle",
      status: "completed",
      streamMessage: undefined,
    });
  });

  it("preserves an interrupted draft in runtime when aborted", async () => {
    abortMock.mockImplementation(() => {
      agentState.isStreaming = false;
      resolvePrompt?.();
    });

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true;
      const assistant = createAssistantMessage({
        content: [{ text: "Partial", type: "text" }],
        id: "assistant-stream",
        stopReason: "toolUse",
      });
      agentState.streamMessage = assistant;
      subscriber?.({
        message: assistant,
        type: "message_update",
      });

      await new Promise<void>((resolve) => {
        resolvePrompt = resolve;
      });
    });

    const worker = await import("@/agent/runtime-worker");

    await worker.startTurn({
      ownerTabId: "tab-1",
      session: createSession(),
      turn: createTurn(),
    });
    await sleep(70);

    await worker.abortTurn("session-1");
    await flushMicrotasks();

    expect(await worker.waitForTurn("session-1")).toEqual({
      sessionId: "session-1",
      status: "aborted",
    });
    expect(await getSessionMessages("session-1")).toHaveLength(1);
    expect(await getSessionRuntime("session-1")).toMatchObject({
      phase: "interrupted",
      status: "aborted",
      streamMessage: expect.objectContaining({
        content: [{ text: "Partial", type: "text" }],
      }),
    });
  });

  it("persists runtime notices for actionable repo errors", async () => {
    abortMock.mockImplementation(() => {
      agentState.isStreaming = false;
      resolvePrompt?.();
    });

    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true;
      const assistant = createAssistantMessage({
        content: [{ text: "Reading...", type: "text" }],
        id: "assistant-stream",
        stopReason: "toolUse",
      });
      agentState.streamMessage = assistant;
      subscriber?.({
        message: assistant,
        type: "message_update",
      });

      await new Promise<void>((resolve) => {
        resolvePrompt = resolve;
      });
    });

    const worker = await import("@/agent/runtime-worker");
    const repoModule = await import("@/lib/github");

    await worker.startTurn({
      ownerTabId: "tab-1",
      session: createSession(),
      turn: createTurn(),
    });

    await onRepoError?.(new repoModule.GitHubFsError("EACCES", "Authentication required: /", "/"));
    await flushMicrotasks();

    expect(abortMock).toHaveBeenCalledTimes(1);
    expect(await getSessionMessages("session-1")).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "system", source: "github" })]),
    );
    expect(await getSessionRuntime("session-1")).toMatchObject({
      phase: "running",
      status: "streaming",
    });

    await worker.disposeSession("session-1");
  });

  it("routes idle configuration changes through the worker", async () => {
    const worker = await import("@/agent/runtime-worker");
    const session = createSession();

    await worker.setModelSelection({
      modelId: "gpt-5.5",
      providerGroup: "openai-codex",
      sessionId: session.id,
    });

    await worker.setThinkingLevel({
      sessionId: session.id,
      thinkingLevel: "high",
    });

    const persisted = await getSession(session.id);
    expect(persisted).toBeUndefined();

    await worker.startTurn({
      ownerTabId: "tab-1",
      session,
      turn: createTurn(),
    });
    await worker.disposeSession(session.id);
  });

  it("does not write a late assistant draft after completion", async () => {
    promptMock.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        resolvePrompt = () => {
          const assistant = createAssistantMessage({
            content: [{ text: "Finished", type: "text" }],
            id: "assistant-final",
          });
          agentState.isStreaming = false;
          agentState.streamMessage = null;
          subscriber?.({
            message: assistant,
            type: "message_end",
          });
          resolve();
        };
      });
    });

    const worker = await import("@/agent/runtime-worker");

    await worker.startTurn({
      ownerTabId: "tab-1",
      session: createSession(),
      turn: createTurn(),
    });

    resolvePrompt?.();
    await flushMicrotasks();
    expect(await worker.waitForTurn("session-1")).toEqual({
      sessionId: "session-1",
      status: "completed",
    });

    const lateDraft = createAssistantMessage({
      content: [{ text: "late", type: "text" }],
      id: "assistant-late",
      stopReason: "toolUse",
    });
    agentState.streamMessage = lateDraft;
    subscriber?.({
      message: lateDraft,
      type: "message_update",
    });
    await sleep(70);

    expect(await getSessionRuntime("session-1")).toMatchObject({
      phase: "idle",
      status: "completed",
      streamMessage: undefined,
    });
    expect(await getSessionMessages("session-1")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "assistant-late" })]),
    );
  });

  it("serializes startTurn and appendSessionNotice through one coordinator queue", async () => {
    promptMock.mockImplementation(async () => {
      agentState.isStreaming = true;
      await new Promise<void>((resolve) => {
        resolvePrompt = () => {
          const assistant = createAssistantMessage({
            content: [{ text: "Finished", type: "text" }],
            id: "assistant-final",
          });
          agentState.isStreaming = false;
          agentState.streamMessage = null;
          subscriber?.({
            message: assistant,
            type: "message_end",
          });
          resolve();
        };
      });
    });

    const worker = await import("@/agent/runtime-worker");

    await worker.startTurn({
      ownerTabId: "tab-1",
      session: createSession(),
      turn: createTurn(),
    });

    const noticePromise = worker.appendSessionNotice({
      error: "boom",
      sessionId: "session-1",
    });
    resolvePrompt?.();
    await noticePromise;
    await flushMicrotasks();
    await worker.waitForTurn("session-1");

    const messages = await getSessionMessages("session-1");

    expect(messages[0]).toEqual(expect.objectContaining({ id: "user-1", role: "user" }));
    expect(new Set(messages.map((message) => message.order)).size).toBe(messages.length);
    expect(messages.map((message) => message.order)).toEqual([0, 1, 2]);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "assistant-final", role: "assistant" }),
        expect.objectContaining({ role: "system" }),
      ]),
    );
  });
});
