import { db, getProviderKey, setProviderKey } from "@gitinspect/db";
import { oauthRefresh } from "@gitinspect/pi/auth/oauth-refresh";
import { getPublicApiKeyForProviderGroup } from "@gitinspect/pi/auth/public-provider-fallbacks";
import {
  isOAuthCredentials,
  parseOAuthCredentials,
  serializeOAuthCredentials,
} from "@gitinspect/pi/auth/oauth-types";
import { getProxyConfig } from "@gitinspect/pi/proxy/settings";
import type { ProviderGroupId, ProviderId } from "@gitinspect/pi/types/models";

export interface ResolvedProviderAuth {
  apiKey: string;
  isOAuth: boolean;
  provider: ProviderId;
  storedValue: string;
}

export function credentialsExpireSoon(expiresAt: number, now = Date.now()): boolean {
  return now >= expiresAt - 60_000;
}

async function resolveStoredProviderAuth(
  storedValue: string,
  provider: ProviderId,
): Promise<ResolvedProviderAuth> {
  if (!isOAuthCredentials(storedValue)) {
    return {
      apiKey: storedValue,
      isOAuth: false,
      provider,
      storedValue,
    };
  }

  let credentials = parseOAuthCredentials(storedValue);

  if (credentialsExpireSoon(credentials.expires)) {
    const proxy = await getProxyConfig();
    credentials =
      provider === "anthropic" && proxy.enabled
        ? await oauthRefresh(credentials, { proxyUrl: proxy.url })
        : await oauthRefresh(credentials);
    await db.transaction("rw", db.providerKeys, async () => {
      await setProviderKey(provider, serializeOAuthCredentials(credentials));
    });
    storedValue = serializeOAuthCredentials(credentials);
  }

  const apiKey =
    credentials.providerId === "google-gemini-cli"
      ? JSON.stringify({
          projectId: credentials.projectId,
          token: credentials.access,
        })
      : credentials.access;

  return {
    apiKey,
    isOAuth: true,
    provider,
    storedValue,
  };
}

export async function resolveStoredApiKey(
  storedValue: string,
  provider: ProviderId,
): Promise<string> {
  return (await resolveStoredProviderAuth(storedValue, provider)).apiKey;
}

export async function resolveProviderAuthForProvider(
  provider: ProviderId,
  providerGroup?: ProviderGroupId,
): Promise<ResolvedProviderAuth | undefined> {
  const record = await getProviderKey(provider);

  if (record?.value) {
    return await resolveStoredProviderAuth(record.value, provider);
  }

  const publicApiKey = getPublicApiKeyForProviderGroup(providerGroup);

  if (!publicApiKey) {
    return undefined;
  }

  return {
    apiKey: publicApiKey,
    isOAuth: false,
    provider,
    storedValue: publicApiKey,
  };
}

export async function resolveApiKeyForProvider(
  provider: ProviderId,
  providerGroup?: ProviderGroupId,
): Promise<string | undefined> {
  const resolved = await resolveProviderAuthForProvider(provider, providerGroup);
  return resolved?.apiKey;
}
