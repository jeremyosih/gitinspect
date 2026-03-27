import * as React from "react"
import { githubApiFetch, isRateLimitError, showRateLimitToast } from "@/repo/github-fetch"

/** Public app repo linked from the header and mobile menu (stars from GitHub API). */
export const GITHUB_APP_REPO = {
  owner: "jeremyosih",
  repo: "gitinspect",
} as const

export function useGitHubRepoStargazers(owner: string, repo: string) {
  const [state, setState] = React.useState<
    | { status: "loading" }
    | { status: "ok"; count: number }
    | { status: "error" }
  >({ status: "loading" })

  React.useEffect(() => {
    const ac = new AbortController()

    void (async () => {
      try {
        const res = await githubApiFetch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
          { signal: ac.signal }
        )
        if (!res.ok) {
          setState({ status: "error" })
          return
        }
        const data = (await res.json()) as { stargazers_count: number }
        setState({ status: "ok", count: data.stargazers_count })
      } catch (err) {
        if (isRateLimitError(err)) {
          showRateLimitToast()
          setState({ status: "error" })
        } else if (!ac.signal.aborted) {
          setState({ status: "error" })
        }
      }
    })()

    return () => ac.abort()
  }, [owner, repo])

  return state
}
