import * as React from "react"
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router"
import type { RepoSource } from "@/types/storage"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ChatLogo } from "@/components/chat-logo"
import { GitHubLink } from "@/components/github-link"
import { ThemeToggle } from "@/components/theme-toggle"
import { Icons } from "@/components/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { githubOwnerAvatarUrl } from "@/repo/url"
import { useCurrentRouteTarget } from "@/hooks/use-current-route-target"
import { useSelectedSessionSummary } from "@/hooks/use-selected-session-summary"

function SquareOwnerAvatar({ owner }: { owner: string }) {
  const [failed, setFailed] = React.useState(false)
  const initial = owner.slice(0, 1).toUpperCase()

  return (
    <div
      className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-[10px] font-semibold text-muted-foreground"
      aria-hidden
    >
      {failed ? (
        <span>{initial}</span>
      ) : (
        <img
          alt=""
          className="size-full object-cover"
          src={githubOwnerAvatarUrl(owner)}
          onError={() => {
            setFailed(true)
          }}
        />
      )}
    </div>
  )
}

function HeaderTooltip({
  children,
  label,
}: {
  children: React.ReactElement
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  )
}

function getRepoSourceFromPathname(pathname: string): RepoSource | undefined {
  const segments = pathname.split("/").filter(Boolean)

  if (
    segments.length < 2 ||
    segments[0] === "chat" ||
    segments[0] === "auth"
  ) {
    return undefined
  }

  const [ownerSegment, repoSegment, ...refSegments] = segments
  const owner = decodeURIComponent(ownerSegment)
  const repo = decodeURIComponent(repoSegment)

  if (!owner || !repo) {
    return undefined
  }

  const ref = refSegments.length > 0
    ? decodeURIComponent(refSegments.join("/"))
    : "main"

  return {
    owner,
    ref,
    repo,
  }
}

const repoLinkClass =
  "whitespace-nowrap font-geist-pixel-square text-sm font-semibold leading-none tracking-tight text-foreground underline-offset-4 hover:underline sm:text-base"

export function AppHeader() {
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const search = useSearch({ strict: false })
  const currentRouteTarget = useCurrentRouteTarget()
  const sidebar = search.sidebar === "open" ? "open" : undefined
  const initialQuery =
    typeof search.initialQuery === "string" ? search.initialQuery : undefined
  const sessionId =
    typeof search.session === "string" ? search.session : undefined
  const selectedSession = useSelectedSessionSummary(
    sessionId
  )
  const repoSource = selectedSession?.repoSource ?? getRepoSourceFromPathname(pathname)

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <HeaderTooltip label="Toggle sidebar">
          <SidebarTrigger />
        </HeaderTooltip>
        <Separator className="mr-2 !h-7 !self-center" orientation="vertical" />
        <Breadcrumb className="min-w-0 flex-1 overflow-x-auto">
          <BreadcrumbList className="text-sm sm:text-base">
            {repoSource ? (
              <>
                <BreadcrumbItem className="shrink-0">
                  <span className="inline-flex items-center gap-1.5">
                    <SquareOwnerAvatar owner={repoSource.owner} />
                    <BreadcrumbLink
                      className={repoLinkClass}
                      href={`https://github.com/${encodeURIComponent(repoSource.owner)}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {repoSource.owner}
                    </BreadcrumbLink>
                  </span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="shrink-0 text-muted-foreground [&>svg]:hidden">
                  /
                </BreadcrumbSeparator>
                <BreadcrumbItem className="shrink-0">
                  <BreadcrumbLink
                    className={repoLinkClass}
                    href={`https://github.com/${encodeURIComponent(repoSource.owner)}/${encodeURIComponent(repoSource.repo)}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {repoSource.repo}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            ) : (
              <BreadcrumbItem>
                <BreadcrumbPage className="p-0">
                  <ChatLogo className="w-auto justify-start" />
                </BreadcrumbPage>
              </BreadcrumbItem>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex items-center gap-2 px-3">
        <Separator className="!h-6 !self-center" orientation="vertical" />
        <HeaderTooltip label="Open X">
          <Button asChild className="h-8 shadow-none" size="sm" variant="ghost">
            <a
              href="https://x.com/dinnaiii"
              rel="noreferrer"
              target="_blank"
            >
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
            aria-label="Open settings"
            className="h-8 shadow-none"
            disabled={selectedSession?.isStreaming ?? false}
            onClick={() => {
              if (currentRouteTarget.to === "/") {
                void navigate({
                  to: "/",
                  search: {
                    settings: "providers",
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
                  settings: "providers",
                  sidebar,
                },
              })
            }}
            size="icon-sm"
            variant="ghost"
          >
            <Icons.cog className="text-foreground" />
          </Button>
        </HeaderTooltip>
      </div>
    </header>
  )
}
