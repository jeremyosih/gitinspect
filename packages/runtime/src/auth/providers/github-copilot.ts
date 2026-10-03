import { openPopup } from "@gitinspect/runtime/auth/popup-flow";
import type { OAuthCredentials } from "@gitinspect/runtime/auth/oauth-types";

const decode = (value: string) => atob(value);
const CLIENT_ID = decode("SXYxLmI1MDdhMDhjODdlY2ZlOTg=");

const COPILOT_HEADERS = {
  "Copilot-Integration-Id": "vscode-chat",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "User-Agent": "GitHubCopilotChat/0.35.0",
} as const;

interface DeviceCodeResponse {
  device_code: string;
  expires_in: number;
  interval: number;
  user_code: string;
  verification_uri: string;
}

function getUrls(domain: string) {
  return {
    accessTokenUrl: `https://${domain}/login/oauth/access_token`,
    copilotTokenUrl: `https://api.${domain}/copilot_internal/v2/token`,
    deviceCodeUrl: `https://${domain}/login/device/code`,
  };
}

async function postFormJson(
  url: string,
  body: Record<string, string>,
): Promise<Record<string, string | number>> {
  const response = await fetch(url, {
    body: new URLSearchParams(body),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "GitHubCopilotChat/0.35.0",
    },
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }

  return (await response.json()) as Record<string, string | number>;
}

async function startDeviceFlow(domain: string): Promise<DeviceCodeResponse> {
  const data = await postFormJson(getUrls(domain).deviceCodeUrl, {
    client_id: CLIENT_ID,
    scope: "read:user",
  });

  if (
    typeof data.device_code !== "string" ||
    typeof data.expires_in !== "number" ||
    typeof data.interval !== "number" ||
    typeof data.user_code !== "string" ||
    typeof data.verification_uri !== "string"
  ) {
    throw new Error("Invalid device code response");
  }

  return {
    device_code: data.device_code,
    expires_in: data.expires_in,
    interval: data.interval,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
  };
}

async function pollForAccessToken(
  domain: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresIn: number,
): Promise<string> {
  const deadline = Date.now() + expiresIn * 1000;
  let intervalMs = Math.max(1000, intervalSeconds * 1000);

  while (Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));

    const data = await postFormJson(getUrls(domain).accessTokenUrl, {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    if (typeof data.access_token === "string") {
      return data.access_token;
    }

    if (data.error === "authorization_pending") {
      continue;
    }

    if (data.error === "slow_down") {
      intervalMs += 5000;
      continue;
    }

    throw new Error(
      typeof data.error_description === "string" ? data.error_description : "Device flow failed",
    );
  }

  throw new Error("Device flow timed out");
}

async function fetchCopilotToken(
  githubAccessToken: string,
  domain: string,
): Promise<OAuthCredentials> {
  const response = await fetch(getUrls(domain).copilotTokenUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${githubAccessToken}`,
      ...COPILOT_HEADERS,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Copilot token request failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as {
    expires_at?: number;
    token?: string;
  };

  if (typeof data.token !== "string" || typeof data.expires_at !== "number") {
    throw new Error("Invalid Copilot token response");
  }

  return {
    access: data.token,
    expires: data.expires_at * 1000 - 5 * 60 * 1000,
    providerId: "github-copilot",
    refresh: githubAccessToken,
  };
}

export async function loginGitHubCopilot(
  onDeviceCode: (info: { userCode: string; verificationUri: string }) => void,
): Promise<OAuthCredentials> {
  const domain = "github.com";
  const device = await startDeviceFlow(domain);

  onDeviceCode({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
  });
  openPopup(device.verification_uri);

  const githubAccessToken = await pollForAccessToken(
    domain,
    device.device_code,
    device.interval,
    device.expires_in,
  );

  return await fetchCopilotToken(githubAccessToken, domain);
}

export async function refreshGitHubCopilot(
  credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
  return await fetchCopilotToken(credentials.refresh, "github.com");
}
