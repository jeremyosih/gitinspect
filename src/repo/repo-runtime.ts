import { Bash } from "just-bash/browser"
import { GitHubFs } from "@/repo/github-fs"
import type { RepoExecResult, RepoRuntime } from "@/repo/repo-types"
import { normalizeRepoSource } from "@/repo/settings"
import type { RepoSource } from "@/types/storage"

/** Merge persisted session token (legacy) with global PAT from settings. */
export function mergeRepoSourceWithRuntimeToken(
  source: RepoSource,
  runtimeToken?: string
): RepoSource {
  const rt = runtimeToken?.trim()
  return {
    ...source,
    token: source.token ?? (rt ? rt : undefined),
  }
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function normalizeCwd(next: string | undefined): string {
  if (!next || next === ".") {
    return "/"
  }

  if (next.startsWith("/")) {
    return next
  }

  return `/${next}`
}

export function createRepoRuntime(
  source: RepoSource,
  options?: { runtimeToken?: string }
): RepoRuntime {
  const normalized = normalizeRepoSource(source)

  if (!normalized) {
    throw new Error("A repository owner and name are required")
  }

  const withToken = mergeRepoSourceWithRuntimeToken(normalized, options?.runtimeToken)

  const fs = new GitHubFs({
    owner: withToken.owner,
    ref: withToken.ref,
    repo: withToken.repo,
    token: withToken.token,
  })
  const bash = new Bash({
    cwd: "/",
    fs,
  })
  let cwd = "/"

  return {
    bash,
    fs,
    getCwd() {
      return cwd
    },
    getWarnings() {
      return []
    },
    refresh() {
      fs.refresh()
    },
    setCwd(next) {
      cwd = normalizeCwd(next)
    },
    source: normalized,
  }
}

export async function execInRepoShell(
  runtime: RepoRuntime,
  command: string,
  signal?: AbortSignal
): Promise<RepoExecResult> {
  const cwd = runtime.getCwd()
  const script =
    cwd === "/" ? command : `cd ${shellEscape(cwd)}\n${command}`
  const result = await runtime.bash.exec(script, {
    cwd,
    signal,
  })
  const nextCwd = result.env.PWD

  runtime.setCwd(nextCwd)

  return {
    ...result,
    cwd: runtime.getCwd(),
  }
}
