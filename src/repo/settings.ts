import { deleteSetting, getSetting, setSetting } from "@/db/schema"
import type { RepoSource } from "@/types/storage"

const REPO_OWNER_KEY = "repo.owner"
const REPO_NAME_KEY = "repo.name"
const REPO_REF_KEY = "repo.ref"
const REPO_TOKEN_KEY = "repo.token"

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function normalizeRepoSource(
  source: RepoSource | undefined
): RepoSource | undefined {
  if (!source) {
    return undefined
  }

  const owner = trimToUndefined(source.owner)
  const repo = trimToUndefined(source.repo)

  if (!owner || !repo) {
    return undefined
  }

  return {
    owner,
    ref: trimToUndefined(source.ref) ?? "main",
    repo,
    token: trimToUndefined(source.token),
  }
}

export function formatRepoSourceLabel(source: RepoSource | undefined): string {
  if (!source) {
    return "No repository selected"
  }

  return `${source.owner}/${source.repo}@${source.ref}`
}

export async function getLastUsedRepoSource(): Promise<RepoSource | undefined> {
  const [owner, repo, ref, token] = await Promise.all([
    getSetting(REPO_OWNER_KEY),
    getSetting(REPO_NAME_KEY),
    getSetting(REPO_REF_KEY),
    getSetting(REPO_TOKEN_KEY),
  ])

  return normalizeRepoSource({
    owner: typeof owner === "string" ? owner : "",
    ref: typeof ref === "string" ? ref : "main",
    repo: typeof repo === "string" ? repo : "",
    token: typeof token === "string" ? token : undefined,
  })
}

export async function setLastUsedRepoSource(
  source: RepoSource | undefined
): Promise<void> {
  const normalized = normalizeRepoSource(source)

  if (!normalized) {
    await Promise.all([
      deleteSetting(REPO_OWNER_KEY),
      deleteSetting(REPO_NAME_KEY),
      deleteSetting(REPO_REF_KEY),
      deleteSetting(REPO_TOKEN_KEY),
    ])
    return
  }

  await Promise.all([
    setSetting(REPO_OWNER_KEY, normalized.owner),
    setSetting(REPO_NAME_KEY, normalized.repo),
    setSetting(REPO_REF_KEY, normalized.ref),
    normalized.token
      ? setSetting(REPO_TOKEN_KEY, normalized.token)
      : deleteSetting(REPO_TOKEN_KEY),
  ])
}
