import * as React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MatchState = {
  loaderData?: unknown;
  params: Record<string, string>;
  routeId: string;
};

const state = vi.hoisted<{ match: MatchState }>(() => ({
  match: {
    loaderData: undefined,
    params: {
      sessionId: "session-1",
    },
    routeId: "/chat/$sessionId",
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    search: _search,
    to: _to,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => React.createElement("a", props, children),
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (state: { matches: MatchState[] }) => unknown }) =>
    select({
      matches: [state.match],
    }),
}));

vi.mock("@gitinspect/pi/hooks/use-selected-session-summary", () => ({
  useSelectedSessionSummary: () => ({
    repoSource: {
      owner: "acme",
      ref: "main",
      repo: "demo",
    },
  }),
}));

vi.mock("@gitinspect/ui/components/button", () => ({
  Button: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? children : React.createElement("button", undefined, children),
}));

vi.mock("@gitinspect/ui/components/separator", () => ({
  Separator: () => null,
}));

vi.mock("@gitinspect/ui/components/sidebar", () => ({
  SidebarTrigger: () => React.createElement("button", { type: "button" }, "Sidebar"),
}));

vi.mock("@gitinspect/ui/components/chat-logo", () => ({
  ChatLogo: () => React.createElement("div", undefined, "GitInspect"),
}));

vi.mock("@gitinspect/ui/components/github-link", () => ({
  GitHubLink: () => React.createElement("div", undefined, "GitHub"),
}));

vi.mock("@gitinspect/ui/components/theme-toggle", () => ({
  ThemeToggle: () => React.createElement("button", { type: "button" }, "Theme"),
}));

vi.mock("@gitinspect/ui/lib/feedback-trigger", () => ({
  rememberFeedbackTrigger: vi.fn(),
}));

vi.mock("@gitinspect/ui/components/icons", () => ({
  Icons: {
    cog: () => React.createElement("span", undefined, "Cog"),
    comment: () => React.createElement("span", undefined, "Comment"),
    x: () => React.createElement("span", undefined, "X"),
  },
}));

vi.mock("@gitinspect/ui/components/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
}));

vi.mock("@gitinspect/ui/components/breadcrumb", () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children);

  return {
    Breadcrumb: Passthrough,
    BreadcrumbItem: Passthrough,
    BreadcrumbLink: ({ children, href }: { children: React.ReactNode; href?: string }) =>
      React.createElement("a", { href }, children),
    BreadcrumbList: Passthrough,
    BreadcrumbPage: Passthrough,
  };
});

describe("AppHeader", () => {
  beforeEach(() => {
    state.match = {
      loaderData: undefined,
      params: {
        sessionId: "session-1",
      },
      routeId: "/chat/$sessionId",
    };
  });

  it("shows repo owner, name, and ref for repo-backed session routes", async () => {
    const { AppHeader } = await import("@/components/app-header");

    render(<AppHeader />);

    expect(screen.getByText("acme")).toBeTruthy();
    expect(screen.getByText("demo")).toBeTruthy();
    expect(screen.getByText("[main]")).toBeTruthy();
    expect(screen.getByText("Feedback")).toBeTruthy();
  });

  it("uses loader data so splat routes show the resolved ref", async () => {
    state.match = {
      loaderData: {
        owner: "acme",
        ref: "feature/foo",
        repo: "demo",
      },
      params: {
        _splat: "tree/feature/foo/src/lib",
        owner: "acme",
        repo: "demo",
      },
      routeId: "/$owner/$repo/$",
    };

    const { AppHeader } = await import("@/components/app-header");

    render(<AppHeader />);

    expect(screen.getByText("[feature/foo]")).toBeTruthy();
  });
});
