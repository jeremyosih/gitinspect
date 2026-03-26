import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"
import { Icons } from "@/components/icons"
import { listRepositories } from "@/db/schema"
import { parseRepoQuery } from "@/repo/parse"
import { buildRepoPathname, githubOwnerAvatarUrl } from "@/repo/url"
import { cn } from "@/lib/utils"
import type { RepoSource } from "@/types/storage"

export type RepoComboboxHandle = {
  focusAndClear: () => void
}

type RepoComboboxProps = {
  autoFocus?: boolean
  className?: string
  repoSource?: RepoSource
}

type Mode = "display" | "edit"

export const RepoCombobox = React.forwardRef<
  RepoComboboxHandle,
  RepoComboboxProps
>(function RepoCombobox({ autoFocus = false, className, repoSource }, ref) {
  const navigate = useNavigate()
  const repositories = useLiveQuery(async () => await listRepositories(), [])
  const [mode, setMode] = React.useState<Mode>(
    repoSource && !autoFocus ? "display" : "edit"
  )
  const [query, setQuery] = React.useState("")
  const [isValidating, setIsValidating] = React.useState(false)
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const filteredRepos = React.useMemo(() => {
    if (!repositories) return []
    if (!query.trim()) return repositories.slice(0, 5)
    const lower = query.toLowerCase()
    return repositories
      .filter((r) => `${r.owner}/${r.repo}`.toLowerCase().includes(lower))
      .slice(0, 5)
  }, [repositories, query])

  const showDropdown =
    mode === "edit" && filteredRepos.length > 0

  React.useImperativeHandle(ref, () => ({
    focusAndClear() {
      setQuery("")
      setMode("edit")
    },
  }))

  React.useEffect(() => {
    if (mode === "edit" && inputRef.current) {
      inputRef.current.focus()
    }
  }, [mode])

  React.useEffect(() => {
    if (autoFocus && !repoSource) {
      setMode("edit")
    }
  }, [autoFocus, repoSource])

  React.useEffect(() => {
    setHighlightedIndex(-1)
  }, [query])

  const navigateToRepo = React.useCallback(
    (owner: string, repo: string, refArg?: string) => {
      const path = buildRepoPathname(owner, repo, refArg)
      void navigate({ to: path })
    },
    [navigate]
  )

  const handleSelect = React.useCallback(
    (owner: string, repo: string, refArg: string) => {
      setQuery("")
      setMode("display")
      navigateToRepo(owner, repo, refArg !== "main" ? refArg : undefined)
    },
    [navigateToRepo]
  )

  const handleSubmit = React.useCallback(async () => {
    if (highlightedIndex >= 0 && highlightedIndex < filteredRepos.length) {
      const item = filteredRepos[highlightedIndex]!
      handleSelect(item.owner, item.repo, item.ref)
      return
    }

    const parsed = parseRepoQuery(query)
    if (!parsed) {
      toast.error("Enter a valid owner/repo or GitHub URL")
      return
    }

    setIsValidating(true)
    try {
      const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
        { headers: { Accept: "application/vnd.github+json" } }
      )
      if (!res.ok) {
        toast.error(`Repository ${parsed.owner}/${parsed.repo} not found`)
        return
      }
      setQuery("")
      setMode("display")
      navigateToRepo(
        parsed.owner,
        parsed.repo,
        parsed.ref && parsed.ref !== "main" ? parsed.ref : undefined
      )
    } catch {
      toast.error("Failed to validate repository")
    } finally {
      setIsValidating(false)
    }
  }, [query, highlightedIndex, filteredRepos, handleSelect, navigateToRepo])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault()
        void handleSubmit()
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        if (repoSource) {
          setMode("display")
          setQuery("")
        }
        return
      }
      if (e.key === "ArrowDown" && showDropdown) {
        e.preventDefault()
        setHighlightedIndex((i) =>
          i < filteredRepos.length - 1 ? i + 1 : 0
        )
        return
      }
      if (e.key === "ArrowUp" && showDropdown) {
        e.preventDefault()
        setHighlightedIndex((i) =>
          i > 0 ? i - 1 : filteredRepos.length - 1
        )
        return
      }
    },
    [handleSubmit, repoSource, showDropdown, filteredRepos.length]
  )

  React.useEffect(() => {
    if (mode !== "edit") return

    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        if (repoSource) {
          setMode("display")
          setQuery("")
        }
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [mode, repoSource])

  if (mode === "display" && repoSource) {
    return (
      <button
        className={cn(
          "flex w-fit items-center gap-1.5 rounded-sm border border-border/50 bg-muted/50 px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted",
          className
        )}
        onClick={() => setMode("edit")}
        type="button"
      >
        <OwnerAvatar owner={repoSource.owner} size="sm" />
        <span className="whitespace-nowrap font-mono text-[11px]">
          {repoSource.owner}/{repoSource.repo}
        </span>
      </button>
    )
  }

  return (
    <div ref={containerRef} className={cn("relative w-fit", className)}>
      <div className="flex w-fit items-center gap-1.5 rounded-sm border border-border/50 bg-muted/50 px-2 py-1">
        <Icons.gitHub className="size-3 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          aria-label="Repository (owner/repo)"
          autoComplete="off"
          className="w-[140px] bg-transparent font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          disabled={isValidating}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="owner/repo"
          value={query}
        />
        <span className="flex size-3 shrink-0 items-center justify-center">
          {isValidating ? (
            <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
          ) : null}
        </span>
      </div>

      {showDropdown ? (
        <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[200px] overflow-hidden rounded-sm border border-border bg-popover shadow-md">
          <div className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <Icons.clock className="size-2.5" />
            Recent
          </div>
          {filteredRepos.map((repo, index) => (
            <button
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                highlightedIndex === index && "bg-accent"
              )}
              key={`${repo.owner}/${repo.repo}@${repo.ref}`}
              onClick={() => handleSelect(repo.owner, repo.repo, repo.ref)}
              type="button"
            >
              <OwnerAvatar owner={repo.owner} size="sm" />
              <span className="truncate font-mono text-[11px]">
                {repo.owner}/{repo.repo}
                {repo.ref !== "main" ? (
                  <span className="text-muted-foreground">@{repo.ref}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
})

function OwnerAvatar({
  owner,
  size = "sm",
}: {
  owner: string
  size?: "sm" | "md"
}) {
  const [failed, setFailed] = React.useState(false)
  const sizeClass = size === "sm" ? "size-3" : "size-4"

  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded-full",
        sizeClass
      )}
    >
      {failed ? (
        <Icons.gitHub className={cn(sizeClass, "text-muted-foreground")} />
      ) : (
        <img
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
          src={githubOwnerAvatarUrl(owner)}
        />
      )}
    </div>
  )
}
