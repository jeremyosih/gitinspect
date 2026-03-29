import * as React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  match: {
    params: {
      sessionId: "session-1",
    },
    routeId: "/chat/$sessionId",
  },
}))

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    search: _search,
    to: _to,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("a", props, children),
  useRouterState: ({
    select,
  }: {
    select: (state: {
      matches: Array<{
        params: Record<string, string>
        routeId: string
      }>
    }) => unknown
  }) =>
    select({
      matches: [state.match],
    }),
}))

vi.mock("@/hooks/use-selected-session-summary", () => ({
  useSelectedSessionSummary: () => ({
    repoSource: {
      owner: "acme",
      ref: "main",
      repo: "demo",
    },
  }),
}))

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    asChild,
  }: {
    children: React.ReactNode
    asChild?: boolean
  }) => (asChild ? children : React.createElement("button", undefined, children)),
}))

vi.mock("@/components/ui/separator", () => ({
  Separator: () => null,
}))

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => React.createElement("button", { type: "button" }, "Sidebar"),
}))

vi.mock("@/components/chat-logo", () => ({
  ChatLogo: () => React.createElement("div", undefined, "GitInspect"),
}))

vi.mock("@/components/github-link", () => ({
  GitHubLink: () => React.createElement("div", undefined, "GitHub"),
}))

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => React.createElement("button", { type: "button" }, "Theme"),
}))

vi.mock("@/components/icons", () => ({
  Icons: {
    cog: () => React.createElement("span", undefined, "Cog"),
    x: () => React.createElement("span", undefined, "X"),
  },
}))

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
}))

vi.mock("@/components/ui/breadcrumb", () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children)

  return {
    Breadcrumb: Passthrough,
    BreadcrumbItem: Passthrough,
    BreadcrumbLink: ({
      children,
      href,
    }: {
      children: React.ReactNode
      href?: string
    }) => React.createElement("a", { href }, children),
    BreadcrumbList: Passthrough,
    BreadcrumbPage: Passthrough,
  }
})

describe("AppHeader", () => {
  it("shows repo owner and name for repo-backed session routes", async () => {
    const { AppHeader } = await import("@/components/app-header")

    render(<AppHeader />)

    expect(screen.getByText("acme")).toBeTruthy()
    expect(screen.getByText("demo")).toBeTruthy()
  })
})
