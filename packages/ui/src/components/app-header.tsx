import * as React from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ResolvedRepoSource } from "@gitinspect/db/storage-types";
import { useSelectedSessionSummary } from "@gitinspect/pi/hooks/use-selected-session-summary";
import { githubOwnerAvatarUrl } from "@gitinspect/pi/repo/url";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from "@gitinspect/ui/components/breadcrumb";
import { Button } from "@gitinspect/ui/components/button";
import { ChatLogo } from "@gitinspect/ui/components/chat-logo";
import { GitHubLink } from "@gitinspect/ui/components/github-link";
import { Icons } from "@gitinspect/ui/components/icons";
import { Separator } from "@gitinspect/ui/components/separator";
import { SidebarTrigger } from "@gitinspect/ui/components/sidebar";
import { ThemeToggle } from "@gitinspect/ui/components/theme-toggle";
import { rememberFeedbackTrigger } from "@gitinspect/ui/lib/feedback-trigger";
import { Tooltip, TooltipContent, TooltipTrigger } from "@gitinspect/ui/components/tooltip";
import { cn } from "@gitinspect/ui/lib/utils";

type HeaderRepoSource = Pick<ResolvedRepoSource, "owner" | "repo"> & {
  ref?: string;
};

type RouteMatchLike = {
  loaderData?: unknown;
  params: Record<string, string | undefined>;
  routeId: string;
};

function isHeaderRepoSource(value: unknown): value is HeaderRepoSource {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.owner === "string" && typeof candidate.repo === "string";
}

function getHeaderRepoSource(
  currentMatch: RouteMatchLike,
  selectedSession: { repoSource?: ResolvedRepoSource } | undefined,
): HeaderRepoSource | undefined {
  if (currentMatch.routeId === "/chat/$sessionId") {
    return selectedSession?.repoSource;
  }

  if (isHeaderRepoSource(currentMatch.loaderData)) {
    return currentMatch.loaderData;
  }

  if (currentMatch.routeId === "/$owner/$repo/") {
    return {
      owner: currentMatch.params.owner ?? "",
      ref: undefined,
      repo: currentMatch.params.repo ?? "",
    };
  }

  if (currentMatch.routeId === "/$owner/$repo/$") {
    return {
      owner: currentMatch.params.owner ?? "",
      ref: currentMatch.params._splat ?? "",
      repo: currentMatch.params.repo ?? "",
    };
  }

  return undefined;
}

function SquareOwnerAvatar({ owner }: { owner: string }) {
  const [failed, setFailed] = React.useState(false);
  const initial = owner.slice(0, 1).toUpperCase();

  return (
    <div
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-[10px] font-semibold text-muted-foreground"
    >
      {failed ? (
        <span>{initial}</span>
      ) : (
        <img
          alt=""
          className="size-full object-cover"
          onError={() => {
            setFailed(true);
          }}
          src={githubOwnerAvatarUrl(owner)}
        />
      )}
    </div>
  );
}

function HeaderTooltip({ children, label }: { children: React.ReactElement; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}

const repoLinkClass =
  "whitespace-nowrap font-geist-pixel-square text-sm font-semibold leading-none tracking-tight text-foreground underline-offset-4 hover:underline sm:text-base";

export function AppHeader() {
  const navigate = useNavigate();
  const currentMatch = useRouterState({
    select: (state) => state.matches[state.matches.length - 1],
  });
  const sessionId =
    currentMatch.routeId === "/chat/$sessionId" ? currentMatch.params.sessionId : undefined;
  const selectedSession = useSelectedSessionSummary(sessionId);
  const repoSource = getHeaderRepoSource(currentMatch as RouteMatchLike, selectedSession);

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <HeaderTooltip label="Toggle sidebar">
          <SidebarTrigger />
        </HeaderTooltip>
        <Separator className="mr-2 !h-7 !self-center" orientation="vertical" />
        <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
          <BreadcrumbList className="w-full min-w-0 flex-nowrap justify-start text-sm sm:text-base">
            {repoSource ? (
              <BreadcrumbItem className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-1 items-center justify-start gap-1.5">
                  <SquareOwnerAvatar owner={repoSource.owner} />
                  <BreadcrumbLink
                    className={cn(repoLinkClass, "max-w-[45%] min-w-0 shrink truncate")}
                    href={`https://github.com/${encodeURIComponent(repoSource.owner)}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {repoSource.owner}
                  </BreadcrumbLink>
                  <span aria-hidden className="shrink-0 text-muted-foreground">
                    /
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <BreadcrumbLink
                      className={cn(repoLinkClass, "min-w-0 shrink truncate text-left")}
                      href={`https://github.com/${encodeURIComponent(repoSource.owner)}/${encodeURIComponent(repoSource.repo)}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {repoSource.repo}
                    </BreadcrumbLink>
                    {repoSource.ref ? (
                      <span className="shrink-0 truncate font-geist-pixel-square text-sm font-normal tracking-tight text-muted-foreground sm:text-base">
                        [{repoSource.ref}]
                      </span>
                    ) : null}
                  </div>
                </div>
              </BreadcrumbItem>
            ) : (
              <BreadcrumbItem className="max-w-full min-w-0 flex-1">
                <BreadcrumbPage className="block max-w-full min-w-0 p-0">
                  <ChatLogo className="w-auto min-w-0 justify-start" truncate />
                </BreadcrumbPage>
              </BreadcrumbItem>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="hidden items-center gap-2 px-3 md:flex">
        <Separator className="!h-6 !self-center" orientation="vertical" />
        <HeaderTooltip label="Send feedback">
          <Button
            className="h-8 gap-1.5 shadow-none"
            onClick={(event) => {
              rememberFeedbackTrigger(event.currentTarget);
              void navigate({
                search: (prev) => ({
                  ...prev,
                  feedback: "open",
                }),
                to: ".",
              });
            }}
            size="sm"
            variant="ghost"
          >
            <Icons.comment className="text-foreground" />
            <span>Feedback</span>
          </Button>
        </HeaderTooltip>
        <Separator className="!h-6 !self-center" orientation="vertical" />
        <HeaderTooltip label="Open X">
          <Button asChild className="h-8 shadow-none" size="sm" variant="ghost">
            <a href="https://x.com/dinnaiii" rel="noreferrer" target="_blank">
              <Icons.x className="text-foreground" />
            </a>
          </Button>
        </HeaderTooltip>
        <Separator className="!h-6 !self-center" orientation="vertical" />
        <GitHubLink />
        <Separator className="!h-6 !self-center" orientation="vertical" />
        <ThemeToggle />
        <Separator className="!h-6 !self-center" orientation="vertical" />
        <HeaderTooltip label="Open settings">
          <Button
            asChild
            aria-label="Open settings"
            className="h-8 shadow-none"
            size="icon-sm"
            variant="ghost"
          >
            <Link
              search={(prev) => ({
                ...prev,
                settings: "providers",
              })}
              to="."
            >
              <Icons.cog className="text-foreground" />
            </Link>
          </Button>
        </HeaderTooltip>
      </div>
    </header>
  );
}
