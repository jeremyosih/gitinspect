import * as React from "react";
import { Link, useNavigate, useRouter, useRouterState, useSearch } from "@tanstack/react-router";
import type { SettingsSection } from "@gitinspect/ui/lib/search-state";

import { runtimeClient } from "@gitinspect/pi/agent/runtime-client";
import { Icons } from "@gitinspect/ui/components/icons";
import { CostsPanel } from "@gitinspect/ui/components/costs-panel";
import { DataSettings } from "@gitinspect/ui/components/data-settings";
import { GithubTokenSettings } from "@gitinspect/ui/components/github-token-settings";
import { ProviderSettings } from "@gitinspect/ui/components/provider-settings";
import { ProxySettings } from "@gitinspect/ui/components/proxy-settings";
import { Button } from "@gitinspect/ui/components/button";
import { Dialog, DialogContent, DialogTitle } from "@gitinspect/ui/components/dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@gitinspect/ui/components/breadcrumb";
import { Tabs, TabsList, TabsTrigger } from "@gitinspect/ui/components/tabs";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@gitinspect/ui/components/sidebar";
import { isSettingsSection } from "@gitinspect/ui/lib/search-state";
import { useSelectedSessionSummary } from "@gitinspect/pi/hooks/use-selected-session-summary";

type SettingsSectionItem = {
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  id: SettingsSection;
  label: string;
};

const BASE_SETTINGS_SECTIONS: Array<SettingsSectionItem> = [
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
];

export function AppSettingsDialog(props: {
  pricingLabel?: string;
  pricingPanel?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ strict: false });
  const currentMatch = useRouterState({
    select: (state) => state.matches[state.matches.length - 1],
  });
  const sessionId =
    currentMatch.routeId === "/chat/$sessionId" ? currentMatch.params.sessionId : undefined;
  const session = useSelectedSessionSummary(sessionId);
  const settingsSections = React.useMemo<Array<SettingsSectionItem>>(() => {
    if (!props.pricingPanel) {
      return BASE_SETTINGS_SECTIONS;
    }

    return [
      BASE_SETTINGS_SECTIONS[0],
      BASE_SETTINGS_SECTIONS[1],
      BASE_SETTINGS_SECTIONS[2],
      {
        description: "Plans, checkout, and billing management",
        icon: Icons.crown,
        id: "pricing",
        label: props.pricingLabel ?? "Pricing",
      },
      ...BASE_SETTINGS_SECTIONS.slice(3),
    ];
  }, [props.pricingLabel, props.pricingPanel]);
  const requestedSection =
    typeof search.settings === "string" && isSettingsSection(search.settings)
      ? search.settings
      : undefined;
  const section =
    requestedSection && settingsSections.some((item) => item.id === requestedSection)
      ? requestedSection
      : "providers";
  const open = Boolean(requestedSection) && settingsSections.some((item) => item.id === section);
  const activeSection = settingsSections.find((item) => item.id === section) ?? settingsSections[0];

  const navigateWithSettings = (nextSection: SettingsSection | undefined) => {
    void navigate({
      search: (prev) => ({
        ...prev,
        settings: nextSection,
      }),
      to: ".",
    });
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          navigateWithSettings(undefined);
        }
      }}
      open={open}
    >
      <DialogContent className="flex max-h-[90dvh] min-h-0 w-full max-w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(100%-2rem,36rem)] md:h-[620px] md:max-h-[620px] md:min-h-[620px] md:max-w-5xl">
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
                    {settingsSections.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton asChild isActive={section === item.id}>
                          <Link
                            search={(prev) => ({
                              ...prev,
                              settings: item.id,
                            })}
                            to="."
                          >
                            <item.icon />
                            <span>{item.label}</span>
                          </Link>
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
              <Tabs className="gap-0 md:hidden" value={section}>
                <div className="w-full min-w-0 touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain pb-0.5 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]">
                  <TabsList
                    className="inline-flex h-auto w-max flex-nowrap justify-start gap-4 bg-transparent p-0 px-1 data-[variant=line]:gap-4"
                    variant="line"
                  >
                    {settingsSections.map((item) => (
                      <TabsTrigger
                        asChild
                        className="flex-none gap-1.5 px-1.5 pb-2"
                        key={item.id}
                        value={item.id}
                      >
                        <Link
                          search={(prev) => ({
                            ...prev,
                            settings: item.id,
                          })}
                          to="."
                        >
                          <item.icon className="size-4 shrink-0" />
                          {item.label}
                        </Link>
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
                      navigateWithSettings("proxy");
                    }}
                  />
                ) : null}
                {section === "github" ? (
                  <GithubTokenSettings
                    onTokenSaved={async () => {
                      if (sessionId) {
                        await runtimeClient.refreshGithubToken(sessionId);
                      }
                      await router.invalidate();
                    }}
                  />
                ) : null}
                {section === "proxy" ? <ProxySettings /> : null}
                {section === "costs" ? <CostsPanel session={session} /> : null}
                {section === "pricing" ? (props.pricingPanel ?? null) : null}
                {section === "data" ? <DataSettings /> : null}
                {section === "about" ? <AboutPanel /> : null}
              </div>
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}

/** Source repo for this app (see README). */
const ABOUT_SOURCE_REPO_URL = "https://github.com/jeremyosih/gitoverflow";

function AboutPanel() {
  return (
    <div className="space-y-5">
      {/*
      <div className="rounded-none border border-dashed border-foreground/15 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <div className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
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
            <div className="text-xs font-medium text-emerald-600">Latest</div>
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
      */}

      <div className="space-y-4 text-sm leading-relaxed">
        <p className="text-foreground">
          Ask questions about any GitHub repo from your browser, without cloning. You can replace{" "}
          <span className="font-mono text-[0.9em]">hub</span> with{" "}
          <span className="font-mono text-[0.9em]">inspect</span> in any GitHub URL to open the
          corresponding digest here.
        </p>
        <div>
          <div className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            How it works
          </div>
          <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Research agent</span> — Pick a
              repository and chat in natural language; answers are grounded in the code.
            </li>
            <li>
              <span className="font-medium text-foreground">Stack</span> — Built on pi-mono,
              read-only shell via just-bash, and a virtual filesystem from the GitHub API.
            </li>
            <li>
              <span className="font-medium text-foreground">Private by design</span> — Chats,
              settings, provider keys, and usage stay local-first in Dexie / IndexedDB. If you sign
              in, gitinspect stores a secure session cookie for your account. Private repo access
              uses GitHub OAuth or an optional local access token, while repo and chat fetches stay
              client-side.
            </li>
            <li>
              <span className="font-medium text-foreground">Local first</span> — Agent execution
              runs in a per-tab dedicated worker; durable state stays on the main thread.
            </li>
            <li>
              <span className="font-medium text-foreground">Resilient by design</span> — Lease
              ownership, runtime recovery, and interrupted-turn repair stay on the main thread; the
              worker improves responsiveness, not hidden-tab guarantees.
            </li>
            <li>
              <span className="font-medium text-foreground">Lazy loading</span> — Nothing fetched at
              construction; everything on demand.
            </li>
            <li>
              <span className="font-medium text-foreground">Tree cache</span> — Full repo tree once
              via Git Trees API; stat, exists, and readdir from cache.
            </li>
            <li>
              <span className="font-medium text-foreground">Content cache</span> — File contents by
              blob SHA (content-addressable, never stale).
            </li>
            <li>
              <span className="font-medium text-foreground">Smart API selection</span> — Contents
              API for small files; raw endpoint for large files ({">"}1 MB).
            </li>
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">
          Public repo cards fetch stars and language through a tiny server endpoint for public
          metadata only. Private repo trees, file reads, and chat grounding still stay client-side.
          Unauthenticated GitHub API requests are limited to 60/hour; authenticated requests get
          5,000/hour.
        </p>
      </div>

      <Button asChild className="gap-2" variant="outline">
        <a href={ABOUT_SOURCE_REPO_URL} rel="noreferrer" target="_blank">
          <Icons.gitHub className="size-4" />
          View source on GitHub
        </a>
      </Button>
    </div>
  );
}
