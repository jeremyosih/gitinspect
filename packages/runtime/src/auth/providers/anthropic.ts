import { generatePKCE, postTokenRequest } from "@gitinspect/runtime/auth/oauth-utils";
import { runPopupOAuthFlow } from "@gitinspect/runtime/auth/popup-flow";
import type { OAuthCredentials } from "@gitinspect/runtime/auth/oauth-types";
import type { ProxyRequestOptions } from "@gitinspect/runtime/auth/oauth-utils";

const decode = (value: string) => atob(value);
const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const SCOPES =
  "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

export async function loginAnthropic(
  redirectUri: string,
  options?: ProxyRequestOptions,
): Promise<OAuthCredentials> {
  const { challenge, verifier } = await generatePKCE();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    code: "true",
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    state: verifier,
  });
  const redirect = await runPopupOAuthFlow(`${AUTHORIZE_URL}?${params.toString()}`);
  const code = redirect.searchParams.get("code");
  const state = redirect.searchParams.get("state");

  if (!code || state !== verifier) {
    throw new Error("OAuth callback validation failed");
  }

  const tokenData = await postTokenRequest(
    TOKEN_URL,
    {
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      state,
    },
    options,
  );

  const access = tokenData.access_token;
  const refresh = tokenData.refresh_token;
  const expiresIn = tokenData.expires_in;

  if (typeof access !== "string" || typeof refresh !== "string" || typeof expiresIn !== "number") {
    throw new Error("Token response missing required fields");
  }

  return {
    access,
    expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
    providerId: "anthropic",
    refresh,
  };
}

export async function refreshAnthropic(
  credentials: OAuthCredentials,
  options?: ProxyRequestOptions,
): Promise<OAuthCredentials> {
  const tokenData = await postTokenRequest(
    TOKEN_URL,
    {
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: credentials.refresh,
    },
    options,
  );

  const access = tokenData.access_token;
  const refresh = tokenData.refresh_token;
  const expiresIn = tokenData.expires_in;

  if (typeof access !== "string" || typeof refresh !== "string" || typeof expiresIn !== "number") {
    throw new Error("Token refresh response missing required fields");
  }

  return {
    access,
    expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
    providerId: "anthropic",
    refresh,
  };
}
