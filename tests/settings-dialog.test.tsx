import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"

const {
  navigate,
  state,
} = vi.hoisted(() => ({
  navigate: vi.fn(),
  state: {
    dialogOnOpenChange: undefined as
      | ((open: boolean) => void)
      | undefined,
    search: {
      settings: "providers",
      tab: "suggested",
    } as Record<string, unknown>,
    tabsOnValueChange: undefined as
      | ((value: string) => void)
      | undefined,
  },
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useSearch: () => state.search,
}))

vi.mock("@/agent/runtime-client", () => ({
  runtimeClient: {
    refreshGithubToken: vi.fn(() => Promise.resolve()),
  },
}))

vi.mock("@/hooks/use-current-route-target", () => ({
  useCurrentRouteTarget: () => ({ to: "/" }),
}))

vi.mock("@/hooks/use-selected-session-summary", () => ({
  useSelectedSessionSummary: () => undefined,
}))

vi.mock("@/components/provider-settings", () => ({
  ProviderSettings: () => React.createElement("div", undefined, "providers"),
}))

vi.mock("@/components/github-token-settings", () => ({
  GithubTokenSettings: () => React.createElement("div", undefined, "github"),
}))

vi.mock("@/components/proxy-settings", () => ({
  ProxySettings: () => React.createElement("div", undefined, "proxy"),
}))

vi.mock("@/components/costs-panel", () => ({
  CostsPanel: () => React.createElement("div", undefined, "costs"),
}))

vi.mock("@/components/icons", () => {
  const Icon = () => React.createElement("span")

  return {
    Icons: {
      badgeCheck: Icon,
      bank: Icon,
      cost: Icon,
      faceThinking: Icon,
      gitHub: Icon,
      globe: Icon,
    },
  }
})

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode
    onOpenChange?: (open: boolean) => void
    open?: boolean
  }) => {
    state.dialogOnOpenChange = onOpenChange
    return React.createElement("div", undefined, children)
  },
  DialogContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
}))

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode
    onValueChange?: (value: string) => void
    value?: string
  }) => {
    state.tabsOnValueChange = onValueChange
    return React.createElement("div", undefined, children)
  },
  TabsList: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
  TabsTrigger: ({
    children,
    value,
  }: {
    children: React.ReactNode
    value: string
  }) => React.createElement("button", { type: "button", "data-value": value }, children),
}))

vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
  ToggleGroupItem: ({ children }: { children: React.ReactNode }) =>
    React.createElement("button", { type: "button" }, children),
}))

vi.mock("@/components/ui/sidebar", () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children)

  return {
    Sidebar: Passthrough,
    SidebarContent: Passthrough,
    SidebarGroup: Passthrough,
    SidebarGroupContent: Passthrough,
    SidebarMenu: Passthrough,
    SidebarMenuButton: ({
      children,
      onClick,
    }: {
      children: React.ReactNode
      onClick?: () => void
      isActive?: boolean
    }) => React.createElement("button", { onClick, type: "button" }, children),
    SidebarMenuItem: Passthrough,
    SidebarProvider: Passthrough,
  }
})

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
    size?: string
    variant?: string
    asChild?: boolean
  }) => React.createElement("button", { onClick, type: "button" }, children),
}))

vi.mock("@/components/ui/breadcrumb", () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children)

  return {
    Breadcrumb: Passthrough,
    BreadcrumbItem: Passthrough,
    BreadcrumbList: Passthrough,
    BreadcrumbPage: Passthrough,
    BreadcrumbSeparator: Passthrough,
  }
})

vi.mock("@/components/ui/item", () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children)

  return {
    Item: Passthrough,
    ItemActions: Passthrough,
    ItemContent: Passthrough,
    ItemDescription: Passthrough,
    ItemMedia: Passthrough,
    ItemTitle: Passthrough,
  }
})

describe("settings dialog", () => {
  beforeEach(() => {
    state.dialogOnOpenChange = undefined
    state.tabsOnValueChange = undefined
    state.search = { settings: "providers", tab: "suggested" }
    navigate.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it("does not restore the previous section when dialog open state echoes true", async () => {
    const { AppSettingsDialog } = await import("@/components/settings-dialog")

    render(React.createElement(AppSettingsDialog))

    expect(state.tabsOnValueChange).toBeTypeOf("function")
    expect(state.dialogOnOpenChange).toBeTypeOf("function")

    state.tabsOnValueChange?.("github")

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenLastCalledWith({
      search: {
        settings: "github",
        sidebar: undefined,
        tab: "suggested",
      },
      to: "/",
    })

    state.dialogOnOpenChange?.(true)

    expect(navigate).toHaveBeenCalledTimes(1)
  })
})
