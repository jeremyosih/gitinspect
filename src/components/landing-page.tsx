import * as React from "react"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Icons } from "@/components/icons"
import { ChatLogo } from "@/components/chat-logo"
import { cn } from "@/lib/utils"
import { githubApiFetch, isRateLimitError, showRateLimitToast } from "@/repo/github-fetch"
import { SUGGESTED_REPOS } from "@/repo/suggested-repos"

function useSuggestedRepos(count: number) {
  return React.useMemo(() => {
    const shuffled = [...SUGGESTED_REPOS].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, count)
  }, [count])
}

export function LandingPage() {
  const search = useSearch({ from: "/" })
  const tab = search.tab
  const settings = typeof search.settings === "string" ? search.settings : undefined
  const sidebar = search.sidebar === "open" ? "open" : undefined
  const repositories = useLiveQuery(async () => await listRepositories(), [])
  const recentRepos = React.useMemo(
    () => (repositories ?? []).slice(0, 4),
    [repositories]
  )
  const hasRecent = recentRepos.length > 0
  const suggestedRepos = useSuggestedRepos(4)
  const resolvedTab = tab ?? (hasRecent ? "recent" : "suggested")

  return (
    <div className="flex h-full w-full flex-col items-center overflow-auto p-6 pt-[12vh]">
      <div className="w-full max-w-xl flex-1 space-y-8">
        <div className="space-y-6 text-center">
          <h1 className="sr-only">gitinspect</h1>
          <ChatLogo size="hero" aria-hidden />
          <p className="max-w-md mx-auto text-sm text-muted-foreground">
            GitInspect is an AI coding agent that lives on your browser and can answer questions about any GitHub repository.
          </p>
        </div>

        <div className="space-y-2">
          <LandingRepoForm />
          <p className="text-center text-[11px] text-muted-foreground/60">
            You can also replace &apos;hub&apos; with &apos;inspect&apos; in any GitHub URL.
          </p>
        </div>

        <Tabs value={resolvedTab}>
          <div className="mb-3 flex justify-center">
            <TabsList variant="line">
              <TabsTrigger asChild disabled={!hasRecent} value="recent">
                <Link replace search={{ settings, sidebar, tab: "recent" }} to="/">
                  <Icons.clock className="size-3" />
                  Recent
                </Link>
              </TabsTrigger>
              <TabsTrigger asChild value="suggested">
                <Link replace search={{ settings, sidebar, tab: "suggested" }} to="/">
                  <Icons.sparkles className="size-3" />
                  Suggested
                </Link>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="recent">
            <ul className="space-y-1.5">
              {recentRepos.map((row) => {
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
          </TabsContent>

          <TabsContent value="suggested">
            <ul className="space-y-1.5">
              {suggestedRepos.map((row) => {
                const to = buildRepoPathname(row.owner, row.repo)
                return (
                  <li key={`${row.owner}/${row.repo}`}>
                    <GithubRepo
                      owner={row.owner}
                      repo={row.repo}
                      to={to}
                    />
                  </li>
                )
              })}
            </ul>
          </TabsContent>
        </Tabs>
      </div>

      <footer className="mt-auto w-full max-w-xl shrink-0 pt-16 pb-8 text-center">
        <p className="text-sm text-muted-foreground">
          Made by{" "}
          <a
            className="underline underline-offset-2 decoration-muted-foreground/60 hover:text-foreground hover:decoration-foreground/60"
            href="https://jeremyosih.com/"
            rel="noopener noreferrer"
            target="_blank"
          >
            Jeremy Osih
          </a>
        </p>
        <p className="mt-2 max-w-md mx-auto text-[11px] leading-relaxed text-muted-foreground/70">
          This page respects your privacy by not using cookies or similar technologies and not collecting personal information.
        </p>
      </footer>
    </div>
  )
}


function LandingRepoForm() {
  const navigate = useNavigate()
  const [query, setQuery] = React.useState("")
  const [isValidating, setIsValidating] = React.useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isValidating) return

    const parsed = parseRepoQuery(query)
    if (!parsed) return

    setIsValidating(true)
    try {
      const res = await githubApiFetch(
        `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`
      )
      if (!res.ok) {
        const { toast } = await import("sonner")
        toast.error(`Repository ${parsed.owner}/${parsed.repo} not found`)
        return
      }
      const path = buildRepoPathname(
        parsed.owner,
        parsed.repo,
        parsed.ref && parsed.ref !== "main" ? parsed.ref : undefined
      )
      void navigate({ to: path })
    } catch (err) {
      if (isRateLimitError(err)) {
        showRateLimitToast()
      } else {
        const { toast } = await import("sonner")
        toast.error("Failed to validate repository")
      }
    } finally {
      setIsValidating(false)
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)}>
      <InputGroup
        className={cn(
          "h-11 min-h-11 w-full min-w-0 rounded-none border border-foreground/20 bg-sidebar shadow-none",
          "transition-colors hover:bg-sidebar-accent focus-within:bg-sidebar-accent",
          "has-[[data-slot=input-group-control]:focus-visible]:border-foreground/30",
          "has-[[data-slot=input-group-control]:focus-visible]:ring-0",
          "dark:bg-sidebar"
        )}
      >
        <InputGroupAddon align="inline-start" className="pl-3.5">
          <InputGroupText className="gap-1.5 text-sidebar-foreground">
            <Icons.gitHub className="size-3" />
          </InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          aria-label="GitHub repository URL or owner/repo"
          autoComplete="off"
          className="min-w-0 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50"
          disabled={isValidating}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="https://github.com/owner/repo or owner/repo"
          value={query}
        />
        <InputGroupAddon align="inline-end" className="pr-2.5">
          <span className="flex size-5 items-center justify-center">
            {isValidating ? (
              <span className="size-3.5 animate-spin rounded-full border-2 border-sidebar-foreground/30 border-t-sidebar-foreground" />
            ) : (
              <InputGroupButton
                aria-label="Continue to workspace"
                className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                size="icon-sm"
                type="submit"
                variant="ghost"
              >
                <ArrowRightIcon className="size-3.5" weight="bold" />
              </InputGroupButton>
            )}
          </span>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
