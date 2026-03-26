import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import { useLiveQuery } from "dexie-react-hooks"
import { ArrowRightIcon } from "@phosphor-icons/react"
import { listRepositories } from "@/db/schema"
import { GithubRepo } from "@/components/github-repo"
import { buildRepoPathname } from "@/repo/url"
import { parseRepoQuery } from "@/repo/parse"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Icons } from "@/components/icons"
import { ChatLogo } from "@/components/chat-logo"
import { cn } from "@/lib/utils"

export function LandingPage() {
  const repositories = useLiveQuery(async () => await listRepositories(), [])

  return (
    <div className="flex h-full w-full flex-col items-center justify-center overflow-auto p-6">
      <div className="w-full max-w-xl space-y-8">
        <div className="space-y-6 text-center">
          <h1 className="sr-only">gitinspect</h1>
          <ChatLogo size="hero" aria-hidden />
          <p className="text-xs text-muted-foreground">
            Paste a public GitHub repository URL or{" "}
            <span className="font-mono text-[11px]">owner/repo</span> to open
            it in the workspace.
          </p>
        </div>

        <LandingRepoForm />

        {repositories && repositories.length > 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Recent repositories
            </div>
            <ul className="space-y-1.5">
              {repositories.map((row) => {
                const to = buildRepoPathname(
                  row.owner,
                  row.repo,
                  row.ref !== "main" ? row.ref : undefined
                )
                return (
                  <li key={`${row.owner}/${row.repo}@${row.ref}`}>
                    <GithubRepo
                      owner={row.owner}
                      ref={row.ref}
                      repo={row.repo}
                      to={to}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function LandingRepoForm() {
  const navigate = useNavigate()
  const [query, setQuery] = React.useState("")

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseRepoQuery(query)
    if (!parsed) {
      return
    }

    const path = buildRepoPathname(
      parsed.owner,
      parsed.repo,
      parsed.ref && parsed.ref !== "main" ? parsed.ref : undefined
    )
    void navigate({ to: path })
  }

  return (
    <form onSubmit={onSubmit}>
      <InputGroup
        className={cn(
          "h-11 min-h-11 w-full min-w-0 rounded-none border border-sidebar-border bg-sidebar shadow-none",
          "transition-colors hover:bg-sidebar-accent focus-within:bg-sidebar-accent",
          "has-[[data-slot=input-group-control]:focus-visible]:border-sidebar-border",
          "has-[[data-slot=input-group-control]:focus-visible]:ring-0",
          "dark:bg-sidebar"
        )}
      >
        <InputGroupAddon align="inline-start" className="pl-3">
          <InputGroupText className="gap-1.5 text-sidebar-foreground">
            <Icons.gitHub className="size-3" />
          </InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          aria-label="GitHub repository URL or owner/repo"
          autoComplete="off"
          className="min-w-0 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="https://github.com/owner/repo or owner/repo"
          value={query}
        />
        <InputGroupAddon align="inline-end" className="pr-1">
          <InputGroupButton
            aria-label="Continue to workspace"
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            size="icon-sm"
            type="submit"
            variant="ghost"
          >
            <ArrowRightIcon className="size-3.5" weight="bold" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
