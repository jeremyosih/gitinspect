import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  navigate: vi.fn(),
  search: {
    feedback: "open",
  } as Record<string, unknown>,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useRouterState: ({
    select,
  }: {
    select: (input: {
      matches: Array<{ loaderData?: unknown; params: Record<string, string>; routeId: string }>;
    }) => unknown;
  }) =>
    select({
      matches: [
        {
          params: {
            sessionId: "session-1",
          },
          routeId: "/chat/$sessionId",
        },
      ],
    }),
  useSearch: () => state.search,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme: "dark",
    theme: "system",
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: state.toastError,
    success: state.toastSuccess,
  },
}));

vi.mock("@gitinspect/pi/hooks/use-selected-session-summary", () => ({
  useSelectedSessionSummary: () => ({
    model: "gpt-5-mini",
    provider: "openai-codex",
    providerGroup: "openai-codex",
    repoSource: {
      owner: "acme",
      ref: "main",
      repo: "demo",
    },
  }),
}));

vi.mock("@gitinspect/pi/repo/path-parser", () => ({
  parseRepoRoutePath: () => ({
    owner: "acme",
    repo: "demo",
    tail: "main/src/app.ts",
    type: "tree-page",
  }),
}));

vi.mock("@gitinspect/ui/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@gitinspect/ui/components/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@gitinspect/ui/components/drawer", () => ({
  Drawer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DrawerHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DrawerTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@gitinspect/ui/components/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("FeedbackDialog", () => {
  beforeEach(() => {
    state.fetchMock.mockReset();
    state.navigate.mockReset();
    state.toastError.mockReset();
    state.toastSuccess.mockReset();
    state.search = { feedback: "open" };
    vi.stubGlobal("fetch", state.fetchMock);
    window.history.replaceState({}, "", "/chat/session-1");
  });

  it("renders feedback first, then emotions, then diagnostics and autofocuses the textarea", async () => {
    const { FeedbackDialog } = await import("@/components/feedback-dialog");

    render(<FeedbackDialog />);

    const feedbackField = screen.getByLabelText("Feedback");
    const sadButton = screen.getByRole("button", { name: "Sad" });
    const diagnosticsCheckbox = screen.getByLabelText("Include technical details for debugging");

    expect(
      feedbackField.compareDocumentPosition(sadButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      sadButton.compareDocumentPosition(diagnosticsCheckbox) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.activeElement).toBe(feedbackField);
    expect(
      screen.queryByText("Only add this if you're comfortable sharing browser and app context."),
    ).toBeNull();
  });

  it("shows inline validation before submitting", async () => {
    const { FeedbackDialog } = await import("@/components/feedback-dialog");

    render(<FeedbackDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    expect(screen.getByText("Please choose a sentiment")).toBeTruthy();
    expect(screen.getByText("Please enter your feedback")).toBeTruthy();
    expect(state.fetchMock).not.toHaveBeenCalled();
  });

  it("submits feedback without diagnostics when unchecked", async () => {
    state.fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          issueNumber: 42,
          issueUrl: "https://github.com/acme/demo/issues/42",
          ok: true,
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 201,
        },
      ),
    );
    const { FeedbackDialog } = await import("@/components/feedback-dialog");

    render(<FeedbackDialog />);

    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "The repo switcher feels great." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Happy" }));
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    await waitFor(() => {
      expect(state.fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(JSON.parse(String(state.fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      includeDiagnostics: false,
      message: "The repo switcher feels great.",
      sentiment: "happy",
      website: "",
    });
    expect(state.toastSuccess).toHaveBeenCalled();
  });

  it("includes diagnostics only when opted in", async () => {
    state.fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          issueNumber: 43,
          issueUrl: "https://github.com/acme/demo/issues/43",
          ok: true,
        }),
        {
          headers: {
            "content-type": "application/json",
          },
          status: 201,
        },
      ),
    );
    const { FeedbackDialog } = await import("@/components/feedback-dialog");

    render(<FeedbackDialog />);

    fireEvent.change(screen.getByLabelText("Feedback"), {
      target: { value: "Streaming status is confusing." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sad" }));
    fireEvent.click(screen.getByLabelText("Include technical details for debugging"));
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));

    await waitFor(() => {
      expect(state.fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(JSON.parse(String(state.fetchMock.mock.calls[0]?.[1]?.body))).toEqual(
      expect.objectContaining({
        diagnostics: expect.objectContaining({
          model: "gpt-5-mini",
          pathname: "/chat/session-1",
          provider: "openai-codex",
          repo: {
            owner: "acme",
            path: "src/app.ts",
            ref: "main",
            repo: "demo",
          },
          theme: "system",
        }),
        includeDiagnostics: true,
      }),
    );
  });
});
