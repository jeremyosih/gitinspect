import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createEmptyUsage } from "@/types/models";
import type { ResolvedRepoSource, SessionData } from "@/types/storage";

const useLiveQueryMock = vi.fn();
const navigateMock = vi.fn(async () => {});
const useSearchMock = vi.fn(() => ({}));
const startInitialTurnMock = vi.fn(async () => {});
const createSessionForRepoMock = vi.fn();
const persistLastUsedSessionSettingsMock = vi.fn(async () => {});
const authContextState = {
  value: null as {
    authState: {
      fallbackPat: boolean;
      githubLink: "linked" | "unlinked" | "unknown";
      preferredSource: "oauth" | "pat" | "none";
      repoAccess: "granted" | "missing" | "unknown";
      session: "signed-in" | "signed-out";
    };
    consumeReadyAuthAction: () => {
      content: string;
      route: string;
      type: "send-first-message";
    } | null;
    openAuthDialog: (input?: {
      postAuthAction?: { content: string; route: string; type: "send-first-message" };
      variant?: "default" | "first-message";
    }) => void;
  } | null,
};

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: useLiveQueryMock,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  useSearch: () => useSearchMock(),
}));

vi.mock("@/hooks/use-runtime-session", () => ({
  useRuntimeSession: () => ({
    abort: vi.fn(),
    send: vi.fn(),
    setModelSelection: vi.fn(),
    setThinkingLevel: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-session-ownership", () => ({
  useSessionOwnership: () => ({ kind: "owned" }),
}));

vi.mock("@/agent/runtime-client", () => ({
  runtimeClient: {
    hasActiveTurn: vi.fn(() => false),
    startInitialTurn: startInitialTurnMock,
  },
}));

vi.mock("@/sessions/session-notices", () => ({
  reconcileInterruptedSession: vi.fn(async () => ({ kind: "noop" })),
}));

vi.mock("@/sessions/session-actions", () => ({
  createSessionForChat: vi.fn(),
  createSessionForRepo: createSessionForRepoMock,
  persistLastUsedSessionSettings: persistLastUsedSessionSettingsMock,
  resolveProviderDefaults: vi.fn(async () => ({
    model: "gpt-5.1-codex-mini",
    providerGroup: "openai-codex",
  })),
}));

vi.mock("@/db/schema", () => ({
  touchRepository: vi.fn(async () => {}),
}));

vi.mock("@/components/chat-empty-state", () => ({
  ChatEmptyState: () => <div data-testid="empty-state">empty</div>,
}));

vi.mock("@gitinspect/ui/components/github-auth-context", () => ({
  useGitHubAuthContext: () => authContextState.value,
}));

vi.mock("@/components/chat-composer", () => ({
  ChatComposer: ({ onSend }: { onSend: (content: string) => Promise<void> }) => (
    <button onClick={() => void onSend("hello")} type="button">
      Send
    </button>
  ),
}));

vi.mock("@/components/repo-combobox", () => ({
  RepoCombobox: React.forwardRef(() => <div data-testid="repo-combobox" />),
}));

vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConversationScrollButton: () => null,
}));

vi.mock("@/components/ui/progressive-blur", () => ({
  ProgressiveBlur: () => null,
}));

vi.mock("@/components/chat-message", () => ({
  ChatMessage: () => null,
}));

vi.mock("@/components/chat-adapter", () => ({
  getFoldedToolResultIds: () => new Set<string>(),
}));

function buildSession(): SessionData {
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
    repoSource: buildRepoSource(),
    thinkingLevel: "medium",
    title: "New chat",
    updatedAt: "2026-03-24T12:00:00.000Z",
    usage: createEmptyUsage(),
  };
}

function buildRepoSource(): ResolvedRepoSource {
  return {
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
  };
}

function createDeferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve: () => resolve?.(),
  };
}

function mockChatQueries(options: {
  defaults: {
    model: string;
    providerGroup: string;
    thinkingLevel: string;
  };
  guestChatAcknowledged?: boolean;
  loadedSessionState:
    | { kind: "none" | "missing" }
    | {
        kind: "active";
        viewModel: {
          displayMessages: unknown[];
          hasPartialAssistantText: boolean;
          isStreaming: boolean;
          runtime?: unknown;
          session: SessionData;
          transcriptMessages: unknown[];
        };
      };
}) {
  useLiveQueryMock.mockImplementation(() => {
    const callIndex = useLiveQueryMock.mock.calls.length;

    switch ((callIndex - 1) % 3) {
      case 0:
        return options.loadedSessionState;
      case 1:
        return options.defaults;
      default:
        return [];
    }
  });
}

describe("Chat first send", () => {
  beforeEach(() => {
    authContextState.value = null;
    createSessionForRepoMock.mockReset();
    navigateMock.mockReset();
    persistLastUsedSessionSettingsMock.mockReset();
    startInitialTurnMock.mockReset();
    useLiveQueryMock.mockReset();
  });

  it("starts the initial turn before navigating to the new session", async () => {
    const session = buildSession();
    createSessionForRepoMock.mockResolvedValue(session);
    const defaults = {
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      thinkingLevel: "medium",
    };
    mockChatQueries({
      defaults,
      loadedSessionState: { kind: "none" },
    });

    const { Chat } = await import("@/components/chat");

    render(<Chat repoSource={buildRepoSource()} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Send"));
    });

    await vi.waitFor(() => {
      expect(startInitialTurnMock).toHaveBeenCalledWith(session, "hello");
    });

    expect(startInitialTurnMock.mock.invocationCallOrder[0]).toBeLessThan(
      navigateMock.mock.invocationCallOrder[0],
    );
    expect(navigateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          sessionId: "session-1",
        },
        to: "/chat/$sessionId",
      }),
    );
  });

  it("does not block navigation on settings persistence", async () => {
    const session = buildSession();
    const settingsWrite = createDeferred();
    createSessionForRepoMock.mockResolvedValue(session);
    persistLastUsedSessionSettingsMock.mockImplementation(async () => await settingsWrite.promise);
    const defaults = {
      model: "gpt-5.1-codex-mini",
      providerGroup: "openai-codex",
      thinkingLevel: "medium",
    };
    mockChatQueries({
      defaults,
      loadedSessionState: { kind: "none" },
    });

    const { Chat } = await import("@/components/chat");

    render(<Chat repoSource={buildRepoSource()} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Send"));
    });

    await vi.waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });

    expect(persistLastUsedSessionSettingsMock).toHaveBeenCalledWith(session);
    settingsWrite.resolve();
    await act(async () => {
      await settingsWrite.promise;
    });
  });

  it("opens the auth dialog before the first guest send when acknowledgement is missing", async () => {
    const openAuthDialog = vi.fn();
    authContextState.value = {
      authState: {
        fallbackPat: false,
        githubLink: "unlinked",
        preferredSource: "none",
        repoAccess: "missing",
        session: "signed-out",
      },
      consumeReadyAuthAction: () => null,
      openAuthDialog,
    };
    mockChatQueries({
      defaults: {
        model: "gpt-5.1-codex-mini",
        providerGroup: "openai-codex",
        thinkingLevel: "medium",
      },
      guestChatAcknowledged: false,
      loadedSessionState: { kind: "none" },
    });

    const { Chat } = await import("@/components/chat");

    render(<Chat repoSource={buildRepoSource()} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Send"));
    });

    expect(openAuthDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        postAuthAction: expect.objectContaining({
          content: "hello",
          type: "send-first-message",
        }),
        variant: "first-message",
      }),
    );
    expect(startInitialTurnMock).not.toHaveBeenCalled();
  });

  it("auto-sends the drafted first message after sign-in", async () => {
    const session = buildSession();
    createSessionForRepoMock.mockResolvedValue(session);
    authContextState.value = {
      authState: {
        fallbackPat: false,
        githubLink: "linked",
        preferredSource: "oauth",
        repoAccess: "granted",
        session: "signed-in",
      },
      consumeReadyAuthAction: vi
        .fn<
          () => {
            action: { content: string; route: string; type: "send-first-message" };
            requiresConfirmation: boolean;
          } | null
        >()
        .mockReturnValueOnce({
          action: {
            content: "hello after auth",
            route: "/chat",
            type: "send-first-message",
          },
          requiresConfirmation: false,
        })
        .mockReturnValue(null),
      openAuthDialog: vi.fn(),
    };
    mockChatQueries({
      defaults: {
        model: "gpt-5.1-codex-mini",
        providerGroup: "openai-codex",
        thinkingLevel: "medium",
      },
      guestChatAcknowledged: true,
      loadedSessionState: { kind: "none" },
    });

    const { Chat } = await import("@/components/chat");

    render(<Chat repoSource={buildRepoSource()} />);

    await vi.waitFor(() => {
      expect(startInitialTurnMock).toHaveBeenCalledWith(session, "hello after auth");
    });
  });
});
