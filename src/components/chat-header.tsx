import * as React from "react"
import { useRouterState } from "@tanstack/react-router"
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
import { GitHubLink } from "@/components/github-link"
import { ThemeToggle } from "@/components/theme-toggle"
import { Icons } from "@/components/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { githubOwnerAvatarUrl, parseRepoPathname } from "@/repo/url"

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

type ChatHeaderProps = {
  onOpenSettings: () => void
  settingsDisabled?: boolean
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

export function ChatHeader(props: ChatHeaderProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const parsed = parseRepoPathname(pathname)

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <HeaderTooltip label="Toggle sidebar">
          <SidebarTrigger />
        </HeaderTooltip>
        <Separator className="mr-2 !h-7 !self-center" orientation="vertical" />
        <Breadcrumb className="min-w-0 flex-1 overflow-x-auto">
          <BreadcrumbList className="text-sm sm:text-base">
            {parsed ? (
              <>
                <BreadcrumbItem className="shrink-0">
                  <span className="inline-flex items-center gap-1.5">
                    <SquareOwnerAvatar owner={parsed.owner} />
                    <BreadcrumbLink
                      className="whitespace-nowrap font-medium text-foreground underline-offset-4 hover:underline"
                      href={`https://github.com/${encodeURIComponent(parsed.owner)}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {parsed.owner}
                    </BreadcrumbLink>
                  </span>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="shrink-0" />
                <BreadcrumbItem className="shrink-0">
                  <BreadcrumbLink
                    className="whitespace-nowrap font-medium text-foreground underline-offset-4 hover:underline"
                    href={`https://github.com/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {parsed.repo}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            ) : (
              <BreadcrumbItem>
                <BreadcrumbPage className="font-medium">gitinspect</BreadcrumbPage>
              </BreadcrumbItem>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="flex items-center gap-2 px-3">
        <Separator className="!h-6 !self-center" orientation="vertical" />
        <HeaderTooltip label="Open Twitter">
          <Button asChild className="h-8 shadow-none" size="sm" variant="ghost">
            <a href="https://twitter.com" rel="noreferrer" target="_blank">
              <Icons.twitter className="text-foreground" />
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
            disabled={props.settingsDisabled}
            onClick={props.onOpenSettings}
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
