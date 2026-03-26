import * as React from "react"
import { Link } from "@tanstack/react-router"
import { ArrowRightIcon, StarIcon } from "@phosphor-icons/react"

import { Icons } from "@/components/icons"
import { formatGitHubStarCount } from "@/lib/format-github-stars"
import { cn } from "@/lib/utils"
import { githubOwnerAvatarUrl } from "@/repo/url"

export type GithubRepoProps = {
  owner: string
  repo: string
  /** When not `main`, shown after the repo name */
  ref?: string
  to: string
  className?: string
  /** When false, renders as a static card without arrow or link behavior. Default true. */
  isLink?: boolean
}

type RepoApiPayload = {
  language: string | null
  stargazers_count: number
}

/** GitHub linguist colors for common languages (fallback: neutral) */
const LANGUAGE_DOT: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Rust: "#dea584",
  Go: "#00add8",
  Python: "#3572a5",
  Java: "#b07219",
  "C++": "#f34b7d",
  "C#": "#178600",
  Ruby: "#701516",
  Swift: "#f05138",
  Kotlin: "#a97bff",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Vue: "#41b883",
  Astro: "#ff5a03",
  Svelte: "#ff3e00",
}

function usePublicRepoMeta(owner: string, repo: string) {
  const [state, setState] = React.useState<
    | { status: "loading" }
    | { status: "ok"; language: string | null; stargazers: number }
    | { status: "error" }
  >({ status: "loading" })

  React.useEffect(() => {
    const ac = new AbortController()
    setState({ status: "loading" })

    void (async () => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
          {
            headers: { Accept: "application/vnd.github+json" },
            signal: ac.signal,
          }
        )
        if (!res.ok) {
          setState({ status: "error" })
          return
        }
        const data = (await res.json()) as RepoApiPayload
        setState({
          status: "ok",
          language: data.language,
          stargazers: data.stargazers_count,
        })
      } catch {
        if (!ac.signal.aborted) {
          setState({ status: "error" })
        }
      }
    })()

    return () => ac.abort()
  }, [owner, repo])

  return state
}

export function GithubRepo({ owner, repo, ref: refName, to, className, isLink = true }: GithubRepoProps) {
  const meta = usePublicRepoMeta(owner, repo)
  const avatarSrc = githubOwnerAvatarUrl(owner)
  const [avatarFailed, setAvatarFailed] = React.useState(false)

  const language =
    meta.status === "ok" ? meta.language : null
  const stars =
    meta.status === "ok" ? meta.stargazers : null
  const langColor =
    language != null && language !== "" ? LANGUAGE_DOT[language] : undefined

  const refSuffix =
    refName && refName !== "main" ? `@${refName}` : ""

  const sharedClassName = cn(
    "group relative flex min-h-11 w-full items-center gap-3 border border-sidebar-border bg-sidebar px-3 py-2 text-left shadow-none transition-colors",
    "rounded-none",
    isLink && "hover:bg-sidebar-accent",
    className
  )

  const content = (
    <>
      <div
        className="relative size-8 shrink-0 overflow-hidden border border-sidebar-border/80 bg-background"
        aria-hidden
      >
        {avatarFailed ? (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <Icons.gitHub className="size-4" />
          </div>
        ) : (
          <img
            alt=""
            className="size-full object-cover"
            decoding="async"
            loading="lazy"
            onError={() => setAvatarFailed(true)}
            src={avatarSrc}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="font-geist-pixel-square truncate text-[11px] leading-tight tracking-tight sm:text-xs">
          <span className="text-foreground">{owner}</span>
          <span className="font-normal text-muted-foreground">/</span>
          <span className="text-foreground">{repo}</span>
          {refSuffix ? (
            <span className="ml-1 font-normal text-muted-foreground">
              {refSuffix}
            </span>
          ) : null}
        </div>
      </div>

      <div className="hidden min-w-0 shrink-0 items-center gap-1.5 sm:flex">
        {meta.status === "loading" ? (
          <span className="h-3 w-14 animate-pulse rounded bg-muted-foreground/15" />
        ) : language ? (
          <>
            <span
              className={cn(
                "size-2 shrink-0 rounded-full border border-border/50",
                langColor == null && "bg-muted-foreground/55"
              )}
              style={langColor ? { backgroundColor: langColor } : undefined}
            />
            <span className="max-w-[7rem] truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {language}
            </span>
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground/70">—</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 tabular-nums">
        <StarIcon
          className="size-3.5 text-muted-foreground/80"
          weight="regular"
        />
        {meta.status === "loading" ? (
          <span className="h-3 w-8 animate-pulse rounded bg-muted-foreground/15" />
        ) : stars != null ? (
          <span className="text-[11px] text-muted-foreground">
            {formatGitHubStarCount(stars)}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/70">—</span>
        )}
      </div>

      {isLink ? (
        <ArrowRightIcon
          className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100"
          weight="bold"
        />
      ) : null}
    </>
  )

  if (!isLink) {
    return (
      <div className={sharedClassName}>
        {content}
      </div>
    )
  }

  return (
    <Link
      aria-label={`Open ${owner}/${repo}${refSuffix ? ` at ${refName}` : ""} in workspace`}
      className={sharedClassName}
      to={to}
    >
      {content}
    </Link>
  )
}
