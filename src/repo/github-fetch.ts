import { toast } from "sonner"
import { getGithubPersonalAccessToken } from "@/repo/github-token"

const CACHE_NAME = "github-api"
const FRESH_MS = 2 * 60 * 1000
const STALE_MS = 10 * 60 * 1000
const TIMESTAMP_HEADER = "x-cached-at"

export class GitHubRateLimitError extends Error {
  constructor() {
    super("GitHub API rate limit reached")
    this.name = "GitHubRateLimitError"
  }
}

function buildGithubHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

async function networkFetch(
  url: string,
  token: string | undefined,
  signal?: AbortSignal
): Promise<Response> {
  const res = await fetch(url, {
    headers: buildGithubHeaders(token),
    signal,
  })

  if (res.status === 403 || res.status === 429) {
    throw new GitHubRateLimitError()
  }

  return res
}

async function putCache(cache: Cache, url: string, res: Response) {
  const body = await res.clone().arrayBuffer()
  const cached = new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: new Headers(res.headers),
  })
  cached.headers.set(TIMESTAMP_HEADER, Date.now().toString())
  await cache.put(url, cached)
}

function revalidateInBackground(
  cache: Cache,
  url: string,
  token: string | undefined
) {
  void networkFetch(url, token)
    .then((res) => {
      if (res.ok) return putCache(cache, url, res)
    })
    .catch(() => {})
}

export async function githubApiFetch(
  path: string,
  options?: { signal?: AbortSignal }
): Promise<Response> {
  const url = `https://api.github.com${path}`
  const token = await getGithubPersonalAccessToken()

  if (typeof caches !== "undefined") {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(url)

    if (cached) {
      const cachedAt = Number(cached.headers.get(TIMESTAMP_HEADER) ?? 0)
      const age = Date.now() - cachedAt

      if (age < FRESH_MS) {
        return cached
      }

      if (age < STALE_MS) {
        revalidateInBackground(cache, url, token)
        return cached
      }
    }

    const res = await networkFetch(url, token, options?.signal)
    if (res.ok) {
      await putCache(cache, url, res)
    }
    return res
  }

  return networkFetch(url, token, options?.signal)
}

export function showRateLimitToast() {
  toast.error("GitHub API rate limit reached", {
    action: {
      label: "Add token",
      onClick: () => {
        const url = new URL(window.location.href)
        url.searchParams.set("settings", "github")
        window.history.pushState({}, "", url)
        window.dispatchEvent(new PopStateEvent("popstate"))
      },
    },
  })
}

export function isRateLimitError(err: unknown): err is GitHubRateLimitError {
  return err instanceof GitHubRateLimitError
}
