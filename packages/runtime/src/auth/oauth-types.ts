export interface OAuthCredentials {
  access: string;
  accountId?: string;
  expires: number;
  projectId?: string;
  providerId: "anthropic" | "github-copilot" | "google-gemini-cli" | "openai-codex";
  refresh: string;
}

interface OAuthCredentialsDraft {
  access?: string;
  accountId?: string;
  expires?: number;
  projectId?: string;
  providerId?: string;
  refresh?: string;
}

const OAUTH_PROVIDER_IDS = [
  "anthropic",
  "github-copilot",
  "google-gemini-cli",
  "openai-codex",
] as const satisfies readonly OAuthCredentials["providerId"][];

export function isOAuthProviderId(value: string): value is OAuthCredentials["providerId"] {
  return OAUTH_PROVIDER_IDS.includes(value as OAuthCredentials["providerId"]);
}

function requireString(value: string | number | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`OAuth credentials are missing ${field}`);
  }

  return value;
}

function requireNumber(value: string | number | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`OAuth credentials have invalid ${field}`);
  }

  return value;
}

function validateDraft(credentials: OAuthCredentialsDraft): OAuthCredentials {
  const providerId = credentials.providerId;

  if (!providerId || !isOAuthProviderId(providerId)) {
    throw new Error("OAuth credentials have invalid providerId");
  }

  const normalized: OAuthCredentials = {
    access: requireString(credentials.access, "access"),
    expires: requireNumber(credentials.expires, "expires"),
    providerId,
    refresh: requireString(credentials.refresh, "refresh"),
  };

  if (providerId === "openai-codex") {
    normalized.accountId = requireString(credentials.accountId, "accountId");
  }

  if (providerId === "google-gemini-cli") {
    normalized.projectId = requireString(credentials.projectId, "projectId");
  }

  return normalized;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  try {
    if (typeof atob === "function") {
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }

    throw new Error("Base64 decoding is unavailable");
  } catch {
    throw new Error("Invalid login code");
  }
}

export function isOAuthCredentials(value: string): boolean {
  return value.startsWith("{");
}

export function parseOAuthCredentials(value: string): OAuthCredentials {
  return validateDraft(JSON.parse(value) as OAuthCredentialsDraft);
}

export function serializeOAuthCredentials(credentials: OAuthCredentials): string {
  return JSON.stringify(validateDraft(credentials));
}

export function parseImportedOAuthCredentials(value: string): OAuthCredentials {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error("Enter a login code first");
  }

  if (trimmed.startsWith("{")) {
    return parseOAuthCredentials(trimmed);
  }

  return parseOAuthCredentials(decodeBase64Url(trimmed));
}
