import * as React from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowUpRight, BadgeCheck } from "lucide-react"
import { runtimeClient } from "@/agent/runtime-client"
import { Icons } from "@/components/icons"
import { CostsPanel } from "@/components/costs-panel"
import { DataSettings } from "@/components/data-settings"
import { GithubTokenSettings } from "@/components/github-token-settings"
import { ProviderSettings } from "@/components/provider-settings"
import { ProxySettings } from "@/components/proxy-settings"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { useCurrentRouteTarget } from "@/hooks/use-current-route-target"
import { useSelectedSessionSummary } from "@/hooks/use-selected-session-summary"

export type SettingsSection =
  | "providers"
  | "github"
  | "costs"
  | "proxy"
  | "data"
  | "about"
type AboutDemoState = "update" | "latest"

const SETTINGS_SECTIONS: Array<{
  description: string
  icon: React.ComponentType<{ className?: string }>
  id: SettingsSection
  label: string
}> = [
  {
    description: "Local provider credentials and OAuth",
    icon: Icons.badgeCheck,
    id: "providers",
    label: "Providers",
  },
  {
    description: "GitHub API access for repository tools",
    icon: Icons.gitHub,
    id: "github",
    label: "GitHub",
  },
  {
    description: "Session and daily usage totals",
    icon: Icons.cost,
    id: "costs",
    label: "Costs",
  },
  {
    description: "Proxy routing for provider requests",
    icon: Icons.globe,
    id: "proxy",
    label: "Proxy",
  },
  {
    description: "Export chat or wipe all local app data",
    icon: Icons.bank,
    id: "data",
    label: "Data",
  },
  {
    description: "What gitinspect.com is and how it works",
    icon: Icons.faceThinking,
    id: "about",
    label: "About",
  },
]

export function AppSettingsDialog() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const currentRouteTarget = useCurrentRouteTarget()
  const sessionId =
    typeof search.session === "string" ? search.session : undefined
  const session = useSelectedSessionSummary(sessionId)
  const section =
    typeof search.settings === "string" && isSettingsSection(search.settings)
      ? search.settings
      : "providers"
  const open =
    typeof search.settings === "string" && isSettingsSection(search.settings)
  const sidebar = search.sidebar === "open" ? "open" : undefined
  const initialQuery =
    typeof search.initialQuery === "string" ? search.initialQuery : undefined
  const activeSection =
    SETTINGS_SECTIONS.find((item) => item.id === section) ?? SETTINGS_SECTIONS[0]

  const navigateWithSettings = (nextSection: SettingsSection | undefined) => {
    if (currentRouteTarget.to === "/") {
      void navigate({
        to: "/",
        search: {
          ...search,
          settings: nextSection,
          sidebar,
        },
      })
      return
    }

    void navigate({
      ...currentRouteTarget,
      search: {
        initialQuery,
        session: sessionId,
        settings: nextSection,
        sidebar,
      },
    })
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          navigateWithSettings(undefined)
        }
      }}
      open={open}
    >
      <DialogContent className="flex min-h-0 w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 max-h-[90dvh] sm:max-w-[min(100%-2rem,36rem)] md:h-[620px] md:max-h-[620px] md:min-h-[620px] md:max-w-5xl">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <SidebarProvider className="flex min-h-0 min-w-0 flex-1 flex-row items-stretch overflow-hidden md:h-full md:min-h-0">
          <Sidebar
            className="hidden border-r border-foreground/10 md:flex md:h-full md:min-h-0 md:self-stretch"
            collapsible="none"
          >
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {SETTINGS_SECTIONS.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={section === item.id}
                          onClick={() => {
                            navigateWithSettings(item.id)
                          }}
                        >
                          <item.icon />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:min-h-0">
            <header className="shrink-0 border-b border-foreground/10 px-5 pt-4 md:h-16 md:pt-0">
              <div className="flex min-h-11 items-center">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbPage>Settings</BreadcrumbPage>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{activeSection.label}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
              <Tabs
                className="gap-0 md:hidden"
                onValueChange={(value) => {
                  if (isSettingsSection(value)) {
                    navigateWithSettings(value)
                  }
                }}
                value={section}
              >
                <div className="min-w-0 w-full touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] pb-0.5 [scrollbar-width:thin]">
                  <TabsList
                    className="inline-flex h-auto w-max flex-nowrap justify-start gap-4 bg-transparent p-0 px-1 data-[variant=line]:gap-4"
                    variant="line"
                  >
                    {SETTINGS_SECTIONS.map((item) => (
                      <TabsTrigger
                        className="flex-none gap-1.5 px-1.5 pb-2"
                        key={item.id}
                        value={item.id}
                      >
                        <item.icon className="size-4 shrink-0" />
                        {item.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
              </Tabs>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="mb-4 max-w-2xl">
                <div className="text-sm font-medium">{activeSection.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {activeSection.description}
                </div>
              </div>
              <div className="max-w-3xl">
                {section === "providers" ? (
                  <ProviderSettings
                    onNavigateToProxy={() => {
                      navigateWithSettings("proxy")
                    }}
                  />
                ) : null}
                {section === "github" ? (
                  <GithubTokenSettings
                    onTokenSaved={async () => {
                      if (!sessionId) {
                        return
                      }

                      await runtimeClient.refreshGithubToken(sessionId)
                    }}
                  />
                ) : null}
                {section === "proxy" ? <ProxySettings /> : null}
                {section === "costs" ? (
                  <CostsPanel session={session} />
                ) : null}
                {section === "data" ? <DataSettings /> : null}
                {section === "about" ? <AboutPanel /> : null}
              </div>
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  )
}

export function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.id === value)
}

function AboutPanel() {
  const [state, setState] = React.useState<AboutDemoState>("update")
  const isUpdateAvailable = state === "update"

  return (
    <div className="space-y-5">
      <div className="rounded-none border border-dashed border-foreground/15 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Demo only
            </div>
            <div className="text-sm font-medium">Preview about states</div>
            <div className="max-w-2xl text-xs text-muted-foreground">
              Temporary toggle for comparing the update banner states before we
              ship this to production.
            </div>
          </div>
          <ToggleGroup
            aria-label="About demo state"
            onValueChange={(value) => {
              if (value === "update" || value === "latest") {
                setState(value)
              }
            }}
            size="sm"
            type="single"
            value={state}
            variant="outline"
          >
            <ToggleGroupItem value="update">Needs update</ToggleGroupItem>
            <ToggleGroupItem value="latest">Latest</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <Item
        variant="outline"
        className={
          isUpdateAvailable
            ? "border-amber-500/35 bg-amber-500/5"
            : "border-emerald-500/35 bg-emerald-500/5"
        }
      >
        <ItemMedia variant="icon">
          {isUpdateAvailable ? (
            <ArrowUpRight className="size-5 text-amber-500" />
          ) : (
            <BadgeCheck className="size-5 text-emerald-500" />
          )}
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            {isUpdateAvailable ? "Update Available" : "Up to date"}
          </ItemTitle>
          <ItemDescription>
            {isUpdateAvailable
              ? "A new version (0.6.11) is available."
              : "gitinspect.com is running the latest version (1.0.0)."}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto">
          {isUpdateAvailable ? (
            <Button size="sm" variant="outline">
              Update
            </Button>
          ) : (
            <div className="text-xs font-medium text-emerald-600">
              Latest
            </div>
          )}
        </ItemActions>
      </Item>

      <div className="grid gap-3 md:grid-cols-2">
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>gitinspect.com</ItemTitle>
            <ItemDescription>
              A local-only browser app for inspecting repositories with
              persistent sessions, streaming chat, model selection, and local
              cost tracking.
            </ItemDescription>
          </ItemContent>
        </Item>
        <Item variant="outline">
          <ItemContent>
            <ItemTitle>Private by default</ItemTitle>
            <ItemDescription>
              Sessions, credentials, repo context, and usage data stay in your
              browser.
            </ItemDescription>
          </ItemContent>
        </Item>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {[
          { href: "https://gitinspect.com", label: "Website" },
          { href: "https://gitinspect.com/privacy", label: "Privacy" },
          { href: "https://gitinspect.com/terms", label: "Terms" },
          { href: "https://gitinspect.com/imprint", label: "Imprint" },
        ].map((item, index) => (
          <React.Fragment key={item.label}>
            {index > 0 ? (
              <span className="text-muted-foreground/50">·</span>
            ) : null}
            <Button
              asChild
              className="h-auto px-0 py-0 text-xs font-medium text-muted-foreground hover:text-foreground"
              variant="link"
            >
              <a href={item.href} target="_blank" rel="noreferrer">
                {item.label}
              </a>
            </Button>
          </React.Fragment>
        ))}
      </div>

      <div className="text-xs text-muted-foreground">
        Sessions, credentials, repository context, and usage data stay local in
        your browser.
      </div>
    </div>
  )
}
