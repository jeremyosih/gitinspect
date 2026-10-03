import { generatePKCE } from "@gitinspect/runtime/auth/oauth-utils";
import { runPopupOAuthFlow } from "@gitinspect/runtime/auth/popup-flow";
import type { OAuthCredentials } from "@gitinspect/runtime/auth/oauth-types";

const decode = (value: string) => atob(value);
const CLIENT_ID = decode(
  "NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t",
);
const CLIENT_SECRET = decode("R09DU1BYLTR1SGdNUG0tMW83U2stZ2VWNkN1NWNsWEZzeGw=");
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

async function discoverProject(accessToken: string): Promise<string> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "google-api-nodejs-client/9.15.1",
    "X-Goog-Api-Client": "gl-node/22.17.0",
  };

  const loadResponse = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`, {
    body: JSON.stringify({
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      },
    }),
    headers,
    method: "POST",
  });

  if (!loadResponse.ok) {
    const text = await loadResponse.text();
    throw new Error(`loadCodeAssist failed: ${loadResponse.status} ${text}`);
  }

  const loadData = (await loadResponse.json()) as {
    allowedTiers?: Array<{ id: string; isDefault?: boolean }>;
    cloudaicompanionProject?: string;
  };

  if (typeof loadData.cloudaicompanionProject === "string") {
    return loadData.cloudaicompanionProject;
  }

  const tierId = loadData.allowedTiers?.find((tier) => tier.isDefault)?.id ?? "free-tier";
  const onboardResponse = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`, {
    body: JSON.stringify({
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      },
      tierId,
    }),
    headers,
    method: "POST",
  });

  if (!onboardResponse.ok) {
    const text = await onboardResponse.text();
    throw new Error(`onboardUser failed: ${onboardResponse.status} ${text}`);
  }

  let operation = (await onboardResponse.json()) as {
    done?: boolean;
    name?: string;
    response?: {
      cloudaicompanionProject?: {
        id?: string;
      };
    };
  };

  while (!operation.done && operation.name) {
    await new Promise((resolve) => window.setTimeout(resolve, 5000));
    const response = await fetch(`${CODE_ASSIST_ENDPOINT}/v1internal/${operation.name}`, {
      headers,
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`Project onboarding poll failed: ${response.status}`);
    }

    operation = (await response.json()) as typeof operation;
  }

  const projectId = operation.response?.cloudaicompanionProject?.id;

  if (!projectId) {
    throw new Error("Could not discover a Google Cloud project for Gemini CLI");
  }

  return projectId;
}

export async function loginGeminiCli(redirectUri: string): Promise<OAuthCredentials> {
  const { challenge, verifier } = await generatePKCE();
  const authParams = new URLSearchParams({
    access_type: "offline",
    client_id: CLIENT_ID,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "consent",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    state: verifier,
  });
  const redirect = await runPopupOAuthFlow(`${AUTH_URL}?${authParams.toString()}`);
  const code = redirect.searchParams.get("code");

  if (!code || redirect.searchParams.get("state") !== verifier) {
    throw new Error("OAuth callback validation failed");
  }

  const tokenResponse = await fetch(TOKEN_URL, {
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };

  if (
    typeof tokenData.access_token !== "string" ||
    typeof tokenData.refresh_token !== "string" ||
    typeof tokenData.expires_in !== "number"
  ) {
    throw new Error("Token response missing required fields");
  }

  const projectId = await discoverProject(tokenData.access_token);

  return {
    access: tokenData.access_token,
    expires: Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000,
    projectId,
    providerId: "google-gemini-cli",
    refresh: tokenData.refresh_token,
  };
}

export async function refreshGeminiCli(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  const response = await fetch(TOKEN_URL, {
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: credentials.refresh,
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${text}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
  };

  if (typeof data.access_token !== "string" || typeof data.expires_in !== "number") {
    throw new Error("Token refresh response missing required fields");
  }

  return {
    access: data.access_token,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
    projectId: credentials.projectId,
    providerId: "google-gemini-cli",
    refresh: typeof data.refresh_token === "string" ? data.refresh_token : credentials.refresh,
  };
}
