import * as React from "react";
import { Link, useNavigate, useRouter, useRouterState, useSearch } from "@tanstack/react-router";
import type { SettingsSection } from "@gitinspect/ui/lib/search-state";

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
import { useSelectedSessionSummary } from "@gitinspect/runtime/hooks/use-selected-session-summary";

type SettingsSectionItem = {
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  id: SettingsSection;
  label: string;
};

const BASE_SETTINGS_SECTIONS: Array<SettingsSectionItem> = [
  {
    description: "LLM API keys and OAuth (stored locally)",
    icon: Icons.badgeCheck,
    id: "providers",
    label: "Providers",
  },
  {
    description: "GitHub token for repo API and rate limits",
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

export function AppSettingsDialog(props: { dataPanel?: React.ReactNode }) {
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ strict: false });
  const currentMatch = useRouterState({
    select: (state) => state.matches[state.matches.length - 1],
  });
  const sessionId =
    currentMatch.routeId === "/chat/$sessionId" ? currentMatch.params.sessionId : undefined;
  const session = useSelectedSessionSummary(sessionId);
  const settingsSections = BASE_SETTINGS_SECTIONS;
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
                      await router.invalidate();
                    }}
                  />
                ) : null}
                {section === "proxy" ? <ProxySettings /> : null}
                {section === "costs" ? <CostsPanel session={session} /> : null}
                {section === "data" ? (props.dataPanel ?? <DataSettings />) : null}
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

      <div className="space-y-5 text-sm leading-relaxed">
        <p className="text-foreground">
          Ask questions about any GitHub repo from your browser, without cloning. You can replace{" "}
          <span className="font-mono text-[0.9em]">hub</span> with{" "}
          <span className="font-mono text-[0.9em]">inspect</span> in any GitHub URL to open the
          corresponding view here.
        </p>

        <div>
          <div className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Privacy
          </div>
          <div className="space-y-2 text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Local by default.</span> Chats,
              sessions, settings, optional GitHub token, provider keys, and usage stay only in this
              browser (IndexedDB). Publishing a share uploads that transcript to Cloudflare.
            </p>
            <p>
              <span className="font-medium text-foreground">Network:</span>{" "}
              <span className="font-medium text-foreground">GitHub</span> is called from your
              browser for repo data. With{" "}
              <span className="font-medium text-foreground">your own</span> provider keys or
              subscriptions, chat goes to those APIs (optional proxy in settings).
            </p>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Models &amp; GitHub
          </div>
          <div className="overflow-x-auto rounded-none border border-border/80 text-xs">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-border/80 bg-muted/30">
                  <th className="px-3 py-2 font-medium text-foreground">Setting</th>
                  <th className="px-3 py-2 font-medium text-foreground">What it&apos;s for</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/60">
                  <td className="px-3 py-2 font-medium text-foreground">Providers</td>
                  <td className="px-3 py-2">LLM API keys and OAuth for the models you use.</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-foreground">GitHub</td>
                  <td className="px-3 py-2">
                    Optional PAT (stored only here): higher GitHub API limits and richer repo
                    metadata.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Connect your own API key or provider subscription to chat. Credentials stay in this
            browser.
          </p>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Analytics
          </div>
          <p className="text-muted-foreground">
            We use Vercel (hosting) and OneDollar Stats for aggregate traffic only. They are not
            used to read chats or repo content; chat routes are excluded where configured.
          </p>
        </div>

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
              <span className="font-medium text-foreground">Stack</span> — pi-mono, read-only shell
              via just-bash, virtual filesystem from the GitHub API.
            </li>
            <li>
              <span className="font-medium text-foreground">Local first</span> — Agent runs in a
              per-tab dedicated worker; durable state stays on the main thread.
            </li>
            <li>
              <span className="font-medium text-foreground">Resilient</span> — Lease ownership,
              recovery, and interrupted-turn repair on the main thread.
            </li>
            <li>
              <span className="font-medium text-foreground">Lazy loading</span> — Nothing prefetched
              at construction; everything on demand.
            </li>
            <li>
              <span className="font-medium text-foreground">Tree cache</span> — Full repo tree once;
              stat, exists, readdir from cache.
            </li>
            <li>
              <span className="font-medium text-foreground">Content cache</span> — File contents by
              blob SHA (content-addressable).
            </li>
            <li>
              <span className="font-medium text-foreground">Smart API selection</span> — Contents
              API for small files; raw endpoint for large files ({">"}1 MB).
            </li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">
          Unauthenticated GitHub API requests are limited to 60/hour; authenticated requests get
          5,000/hour. Add a token under GitHub settings to raise limits; the tree cache keeps usage
          low after the initial load.
        </p>

        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">AI disclosure:</span> This codebase has been
          built with a lot of support from AI. Very little is hand-written; GPT 5.4 was used to
          create this repository alongside that small amount of manual code.
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
