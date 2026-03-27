import * as React from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
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
import type { RepositoryRow } from "@/types/storage"

const SUGGESTED_REPOS: ReadonlyArray<
  Pick<RepositoryRow, "owner" | "repo" | "ref">
> = [
  { owner: "imputnet", repo: "helium", ref: "main" },
  { owner: "pierrecomputer", repo: "pierre", ref: "main" },
  { owner: "jeremyosih", repo: "gitinspect", ref: "main" },
  { owner: "alibaba", repo: "OpenSandbox", ref: "main" },
  { owner: "coderamp-labs", repo: "gitingest", ref: "main" },
  { owner: "twentyhq", repo: "twenty", ref: "main" },
  { owner: "badlogic", repo: "pi-mono", ref: "main" },
  { owner: "openclaw", repo: "openclaw", ref: "main" },
  { owner: "oven-sh", repo: "bun", ref: "main" },
  { owner: "vercel-labs", repo: "just-bash", ref: "main" },
  { owner: "Effect-TS", repo: "effect", ref: "main" },
  { owner: "rocicorp", repo: "mono", ref: "main" },
  { owner: "zml", repo: "zml", ref: "main" },
  { owner: "anomalyco", repo: "opencode", ref: "main" },
  { owner: "durable-streams", repo: "durable-streams", ref: "main" },
  { owner: "rivet-dev", repo: "rivet", ref: "main" },
  { owner: "better-auth", repo: "better-auth", ref: "main" },
]

function useSuggestedRepos(count: number) {
  return React.useMemo(() => {
    const shuffled = [...SUGGESTED_REPOS].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, count)
  }, [count])
}

export function LandingPage() {
  const navigate = useNavigate()
  const search = useSearch({ from: "/" })
  const tab = search.tab
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
      <div className="w-full max-w-xl space-y-8">
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

        <Tabs
          value={resolvedTab}
          onValueChange={(value) => {
            void navigate({
              to: "/",
              search: {
                ...search,
                tab: value as "recent" | "suggested",
              },
              replace: true,
            })
          }}
        >
          <div className="mb-3 flex justify-center">
            <TabsList variant="line">
              <TabsTrigger disabled={!hasRecent} value="recent">
                <Icons.clock className="size-3" />
                Recent
              </TabsTrigger>
              <TabsTrigger value="suggested">Suggested</TabsTrigger>
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
