import { getIsoNow } from "@gitinspect/pi/lib/dates";
import { deleteProviderKey, getProviderKey, setProviderKey } from "@gitinspect/db";
import { loginAnthropic } from "@gitinspect/pi/auth/providers/anthropic";
import { loginGitHubCopilot } from "@gitinspect/pi/auth/providers/github-copilot";
import { loginGeminiCli } from "@gitinspect/pi/auth/providers/google-gemini-cli";
import { loginOpenAICodex } from "@gitinspect/pi/auth/providers/openai-codex";
import {
  parseImportedOAuthCredentials,
  serializeOAuthCredentials,
  type OAuthCredentials,
} from "@gitinspect/pi/auth/oauth-types";
import type { ProxyRequestOptions } from "@gitinspect/pi/auth/oauth-utils";
import type { ProviderAuthKind, ProviderAuthState } from "@gitinspect/pi/types/auth";
import type { ProviderId } from "@gitinspect/pi/types/models";

export { oauthRefresh } from "@gitinspect/pi/auth/oauth-refresh";

export type OAuthProviderId = "anthropic" | "github-copilot" | "google-gemini-cli" | "openai-codex";

export const OAUTH_PROVIDERS: Record<OAuthProviderId, { label: string }> = {
  anthropic: { label: "Anthropic (Claude Pro/Max)" },
  "github-copilot": { label: "GitHub Copilot" },
  "google-gemini-cli": { label: "Google Gemini" },
  "openai-codex": { label: "ChatGPT Plus/Pro" },
};

export function isOAuthProvider(provider: string): provider is OAuthProviderId {
  return provider in OAUTH_PROVIDERS;
}

export function getOAuthProviderName(provider: OAuthProviderId): string {
  return OAUTH_PROVIDERS[provider].label;
}

export async function oauthLogin(
  provider: OAuthProviderId,
  redirectUri: string,
  onDeviceCode?: (info: { userCode: string; verificationUri: string }) => void,
  options?: ProxyRequestOptions,
): Promise<OAuthCredentials> {
  switch (provider) {
    case "anthropic":
      return await loginAnthropic(redirectUri, options);
    case "github-copilot":
      return await loginGitHubCopilot(onDeviceCode ?? (() => {}));
    case "google-gemini-cli":
      return await loginGeminiCli(redirectUri);
    case "openai-codex":
      return await loginOpenAICodex(redirectUri);
  }
}

export async function upsertProviderOAuth(
  provider: ProviderId,
  credentials: OAuthCredentials,
): Promise<void> {
  await setProviderKey(provider, serializeOAuthCredentials(credentials));
}

export async function importOAuthCredentials(value: string): Promise<OAuthCredentials> {
  const credentials = parseImportedOAuthCredentials(value);
  await upsertProviderOAuth(credentials.providerId, credentials);
  return credentials;
}

export async function importOAuthCredentialsForProvider(
  provider: OAuthProviderId,
  value: string,
): Promise<OAuthCredentials> {
  const credentials = parseImportedOAuthCredentials(value);

  if (credentials.providerId !== provider) {
    throw new Error(
      `This code is for ${getOAuthProviderName(credentials.providerId)}. Paste it into the ${getOAuthProviderName(provider)} row instead.`,
    );
  }

  await upsertProviderOAuth(provider, credentials);
  return credentials;
}

export async function setProviderApiKey(provider: ProviderId, value: string): Promise<void> {
  await setProviderKey(provider, value);
}

export async function disconnectProvider(provider: ProviderId): Promise<void> {
  await deleteProviderKey(provider);
}

export async function getProviderAuthState(provider: ProviderId): Promise<ProviderAuthState> {
  const record = await getProviderKey(provider);
  const authKind: ProviderAuthKind = !record?.value
    ? "none"
    : record.value.startsWith("{")
      ? "oauth"
      : "api-key";

  return {
    authKind,
    hasValue: Boolean(record?.value),
    provider,
    updatedAt: record?.updatedAt ?? getIsoNow(),
  };
}
