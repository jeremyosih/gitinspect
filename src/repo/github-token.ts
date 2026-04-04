import { deleteSetting, getSetting, setSetting } from "@/db/schema"
import {
  loginGitHub,
  refreshGitHub,
  type GitHubCredentials,
} from "@/auth/providers/github"

const GITHUB_KEY = "github.credentials"

export async function getGithubPersonalAccessToken(): Promise<string | undefined> {
  const credentials = await loadCredentials()
  if (!credentials) return undefined

  if (Date.now() < credentials.expiresAt) {
    return credentials.accessToken
  }

  if (Date.now() >= credentials.refreshTokenExpiresAt) {
    await deleteCredentials()
    return undefined
  }

  try {
    const refreshed = await refreshGitHub(credentials.refreshToken)
    const updated: GitHubCredentials = {
      ...credentials,
      ...refreshed,
    }
    await saveCredentials(updated)
    return updated.accessToken
  } catch {
    await deleteCredentials()
    return undefined
  }
}

export async function getGithubLogin(): Promise<string | undefined> {
  const credentials = await loadCredentials()
  return credentials?.login
}

export async function loginWithGitHub(): Promise<string> {
  const redirectUri = `${window.location.origin}/auth/callback`
  const credentials = await loginGitHub(redirectUri)
  await saveCredentials(credentials)
  return credentials.login
}

export async function logoutGitHub(): Promise<void> {
  await deleteCredentials()
}

async function loadCredentials(): Promise<GitHubCredentials | undefined> {
  const raw = await getSetting(GITHUB_KEY)
  if (!raw || typeof raw !== "string") return undefined
  try {
    return JSON.parse(raw) as GitHubCredentials
  } catch {
    return undefined
  }
}

async function saveCredentials(credentials: GitHubCredentials): Promise<void> {
  await setSetting(GITHUB_KEY, JSON.stringify(credentials))
}

async function deleteCredentials(): Promise<void> {
  await deleteSetting(GITHUB_KEY)
}
