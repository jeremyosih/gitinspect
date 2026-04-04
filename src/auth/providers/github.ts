import { generatePKCE, postTokenRequest } from "@/auth/oauth-utils"
import { runPopupOAuthFlow } from "@/auth/popup-flow"

const CLIENT_ID = "Ov23livjmqBTVj8aRNhC"
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
const TOKEN_PROXY_URL = "/api/github-token"

export interface GitHubCredentials {
  accessToken: string
  expiresAt: number
  login: string
  refreshToken: string
  refreshTokenExpiresAt: number
}

export async function loginGitHub(
  redirectUri: string
): Promise<GitHubCredentials> {
  const { challenge, verifier } = await generatePKCE()
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    response_type: "code",
    state: verifier,
  })

  const redirect = await runPopupOAuthFlow(
    `${AUTHORIZE_URL}?${params.toString()}`
  )

  const code = redirect.searchParams.get("code")
  const state = redirect.searchParams.get("state")

  if (!code || state !== verifier) {
    throw new Error("OAuth callback validation failed")
  }

  const tokenData = await postTokenRequest(TOKEN_PROXY_URL, {
    client_id: CLIENT_ID,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  })

  const credentials = parseTokenResponse(tokenData)
  const login = await fetchGitHubLogin(credentials.accessToken)

  return { ...credentials, login }
}

export async function refreshGitHub(
  refreshToken: string
): Promise<Omit<GitHubCredentials, "login">> {
  const tokenData = await postTokenRequest(TOKEN_PROXY_URL, {
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })

  return parseTokenResponse(tokenData)
}

function parseTokenResponse(data: Record<string, unknown>): Omit<GitHubCredentials, "login"> {
  const accessToken = data.access_token

  if (typeof accessToken !== "string") {
    throw new Error("Token response missing access_token")
  }

  const now = Date.now()
  const expiresIn = data.expires_in
  const refreshToken = data.refresh_token
  const refreshTokenExpiresIn = data.refresh_token_expires_in

  // OAuth Apps return non-expiring tokens with no refresh token
  return {
    accessToken,
    expiresAt:
      typeof expiresIn === "number"
        ? now + expiresIn * 1000 - 60_000
        : Number.MAX_SAFE_INTEGER,
    refreshToken: typeof refreshToken === "string" ? refreshToken : "",
    refreshTokenExpiresAt:
      typeof refreshTokenExpiresIn === "number"
        ? now + refreshTokenExpiresIn * 1000 - 60_000
        : Number.MAX_SAFE_INTEGER,
  }
}

async function fetchGitHubLogin(accessToken: string): Promise<string> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })

  if (!response.ok) {
    throw new Error("Failed to verify GitHub token")
  }

  const user = (await response.json()) as { login?: string }
  return user.login ?? "user"
}
