import * as React from "react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
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

type ChatHeaderProps = {
  onOpenSettings: () => void
  settingsDisabled?: boolean
  title?: string
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
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b bg-background">
      <div className="flex flex-1 items-center gap-2 px-3">
        <HeaderTooltip label="Toggle sidebar">
          <SidebarTrigger />
        </HeaderTooltip>
        <Separator className="mr-2 !h-6 !self-center" orientation="vertical" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage className="line-clamp-1 text-base">
                {props.title ?? "New Chat"}
              </BreadcrumbPage>
            </BreadcrumbItem>
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
