import type { JsonValue } from "@gitinspect/runtime/types/common";
import { buildProxiedUrl } from "@gitinspect/runtime/proxy/url";

export interface ProxyRequestOptions {
  proxyUrl?: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function generatePKCE(): Promise<{
  challenge: string;
  verifier: string;
}> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64UrlEncode(verifierBytes);
  const challengeBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );

  return {
    challenge: base64UrlEncode(challengeBytes),
    verifier,
  };
}

export function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function postTokenRequest(
  url: string,
  body: Record<string, string>,
  options?: ProxyRequestOptions,
): Promise<Record<string, JsonValue>> {
  const requestUrl = options?.proxyUrl === undefined ? url : buildProxiedUrl(options.proxyUrl, url);

  const response = await fetch(requestUrl, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token request failed: ${response.status} ${text}`);
  }

  return (await response.json()) as Record<string, JsonValue>;
}
