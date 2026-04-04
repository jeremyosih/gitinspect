import { toast } from "sonner";
import {
  GitHubRateLimitController,
  type GitHubRateLimitKind,
} from "@gitinspect/just-github/github-rate-limit";
import {
  readGitHubErrorMessage,
  shouldRetryUnauthenticated,
  stripAuthorization,
} from "@gitinspect/just-github/github-http";
import { classifyRuntimeError } from "@gitinspect/pi/agent/runtime-errors";
import {
  getGitHubNoticeCta,
  resolveRegisteredGitHubAccess,
  type GitHubAuthState,
} from "@gitinspect/pi/repo/github-access";
import { getGitHubAuthUiBridge } from "@gitinspect/pi/repo/github-auth-ui";
import { appendSessionNotice } from "@gitinspect/pi/sessions/session-notices";
import type { SystemMessage } from "@gitinspect/pi/types/chat";

const CACHE_NAME = "github-api";
const FRESH_MS = 2 * 60 * 1000;
const STALE_MS = 10 * 60 * 1000;
const TIMESTAMP_HEADER = "x-cached-at";
const TOAST_DEDUPE_MS = 5 * 1000;

const rateLimitController = new GitHubRateLimitController();
let lastToastSignature = "";
let lastToastAt = 0;

export class GitHubRateLimitError extends Error {
  readonly blockedUntilMs?: number;
  readonly kind: GitHubRateLimitKind;
  readonly status: number;

  constructor(options?: {
    blockedUntilMs?: number;
    kind?: GitHubRateLimitKind;
    message?: string;
    status?: number;
  }) {
    super(
      options?.message ??
        buildRateLimitMessage(options?.kind ?? "unknown", options?.blockedUntilMs),
    );
    this.name = "GitHubRateLimitError";
    this.blockedUntilMs = options?.blockedUntilMs;
    this.kind = options?.kind ?? "unknown";
    this.status = options?.status ?? 429;
  }
}

function buildGithubHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function formatRetryTime(value: number | undefined): string | undefined {
  if (!value || !Number.isFinite(value)) {
    return undefined;
  }

  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildRateLimitMessage(kind: GitHubRateLimitKind, retryAtMs?: number): string {
  const retryLabel = formatRetryTime(retryAtMs);

  if (kind === "primary" && retryLabel) {
    return `GitHub API rate limit exceeded until ${retryLabel}. Add a token to raise the limit.`;
  }

  if (kind === "secondary" && retryLabel) {
    return `GitHub API secondary rate limit exceeded until ${retryLabel}. Add a token or wait before retrying.`;
  }

  if (retryLabel) {
    return `GitHub API rate limit exceeded until ${retryLabel}. Add a token or wait before retrying.`;
  }

  return "GitHub API rate limit exceeded. Add a token or wait before retrying.";
}

function shouldSuppressToast(signature: string): boolean {
  const now = Date.now();

  if (signature === lastToastSignature && now - lastToastAt < TOAST_DEDUPE_MS) {
    return true;
  }

  lastToastSignature = signature;
  lastToastAt = now;
  return false;
}

function toRateLimitError(
  blockedUntilMs: number,
  kind: GitHubRateLimitKind,
  status: number,
): GitHubRateLimitError {
  return new GitHubRateLimitError({
    blockedUntilMs,
    kind,
    status,
  });
}

async function networkFetch(
  url: string,
  token: string | undefined,
  signal?: AbortSignal,
): Promise<Response> {
  const activeBlock = rateLimitController.beforeRequest();
  if (activeBlock) {
    throw toRateLimitError(activeBlock.blockedUntilMs, activeBlock.kind, 429);
  }

  const headers = buildGithubHeaders(token);
  const res = await fetch(url, {
    headers,
    signal,
  });

  const rateLimitBlock = await rateLimitController.afterResponse(res);
  if (rateLimitBlock) {
    throw toRateLimitError(rateLimitBlock.blockedUntilMs, rateLimitBlock.kind, res.status);
  }

  if (!res.ok && token) {
    const detail = await readGitHubErrorMessage(res);
    if (shouldRetryUnauthenticated(res, detail)) {
      const fallback = await fetch(url, {
        headers: stripAuthorization(headers),
        signal,
      });
      const fallbackRateLimitBlock = await rateLimitController.afterResponse(fallback);

      if (!fallbackRateLimitBlock && fallback.ok) {
        return fallback;
      }
    }
  }

  return res;
}

async function putCache(cache: Cache, url: string, res: Response) {
  const body = await res.clone().arrayBuffer();
  const cached = new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: new Headers(res.headers),
  });
  cached.headers.set(TIMESTAMP_HEADER, Date.now().toString());
  await cache.put(url, cached);
}

function revalidateInBackground(cache: Cache, url: string, token: string | undefined) {
  void networkFetch(url, token)
    .then((res) => {
      if (res.ok) return putCache(cache, url, res);
    })
    .catch(() => {});
}

/** Opens app settings on the GitHub token section (same URL pattern as rate-limit toast). */
export function openGithubTokenSettings(): void {
  const url = new URL(window.location.href);
  url.searchParams.set("settings", "github");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export async function githubApiFetch(
  path: string,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  const url = `https://api.github.com${path}`;
  const access = await resolveRegisteredGitHubAccess({ requireRepoScope: true });
  const token = access.ok ? access.token : undefined;

  if (typeof caches !== "undefined") {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url);

    if (cached) {
      if (rateLimitController.beforeRequest()) {
        return cached;
      }

      const cachedAt = Number(cached.headers.get(TIMESTAMP_HEADER) ?? 0);
      const age = Date.now() - cachedAt;

      if (age < FRESH_MS) {
        return cached;
      }

      if (age < STALE_MS) {
        revalidateInBackground(cache, url, token);
        return cached;
      }
    }

    try {
      const res = await networkFetch(url, token, options?.signal);
      if (res.ok) {
        await putCache(cache, url, res);
      }
      return res;
    } catch (error) {
      if (cached && isRateLimitError(error)) {
        return cached;
      }

      throw error;
    }
  }

  return networkFetch(url, token, options?.signal);
}

export function isRateLimitError(err: unknown): err is GitHubRateLimitError {
  return err instanceof GitHubRateLimitError;
}

function showGithubActionToast(input: {
  actionLabel: string;
  message: string;
  onAction?: () => void;
  signature: string;
}): void {
  if (shouldSuppressToast(input.signature)) {
    return;
  }

  toast.error(input.message, {
    action: {
      label: input.actionLabel,
      onClick: () => {
        input.onAction?.();
      },
    },
  });
}

function getFallbackAuthState(): GitHubAuthState {
  return {
    fallbackPat: false,
    githubLink: "unknown",
    preferredSource: "none",
    repoAccess: "unknown",
    session: "signed-out",
  };
}

function getGithubToastAction(kind: SystemMessage["kind"]): {
  label: string;
  onAction: () => void;
} {
  const bridge = getGitHubAuthUiBridge();
  const cta = getGitHubNoticeCta({
    kind,
    state: bridge?.getState() ?? getFallbackAuthState(),
  });

  return {
    label: cta.label,
    onAction: () => {
      if (!bridge) {
        openGithubTokenSettings();
        return;
      }

      void bridge.runNoticeIntent(cta.intent);
    },
  };
}

function showClassifiedGithubToast(
  kind: SystemMessage["kind"],
  signature: string,
  severity?: SystemMessage["severity"],
  error?: unknown,
): void {
  if (kind === "github_rate_limit") {
    const retryAt =
      error instanceof GitHubRateLimitError ? formatRetryTime(error.blockedUntilMs) : undefined;

    const action = getGithubToastAction(kind);

    showGithubActionToast({
      actionLabel: action.label,
      message: retryAt
        ? `GitHub requests are rate limited until ${retryAt}. Sign in or connect GitHub for better limits.`
        : "GitHub requests are rate limited right now. Sign in or connect GitHub for better limits.",
      onAction: action.onAction,
      signature,
    });
    return;
  }

  if (kind === "github_auth") {
    const action = getGithubToastAction(kind);

    showGithubActionToast({
      actionLabel: action.label,
      message: "GitHub authentication failed. Reconnect GitHub or use your PAT fallback.",
      onAction: action.onAction,
      signature,
    });
    return;
  }

  if (kind === "github_permission") {
    const action = getGithubToastAction(kind);

    showGithubActionToast({
      actionLabel: action.label,
      message: "GitHub denied repository access. Grant repo access or switch to a PAT fallback.",
      onAction: action.onAction,
      signature,
    });
    return;
  }

  if (kind === "github_api") {
    if (severity === "warning") {
      return;
    }

    const action = getGithubToastAction(kind);

    showGithubActionToast({
      actionLabel: action.label,
      message: "GitHub request failed. Review your GitHub connection or fallback token.",
      onAction: action.onAction,
      signature,
    });
  }
}

export function showGithubSystemNoticeToast(
  notice: Extract<SystemMessage, { role: "system" }>,
): boolean {
  if (notice.source !== "github") {
    return false;
  }

  showClassifiedGithubToast(notice.kind, notice.fingerprint, notice.severity);
  return true;
}

export async function handleGithubError(
  error: unknown,
  options?: { sessionId?: string },
): Promise<boolean> {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const classified = classifyRuntimeError(normalized);

  if (classified.source !== "github") {
    return false;
  }

  if (options?.sessionId) {
    await appendSessionNotice(options.sessionId, normalized);
  }

  showClassifiedGithubToast(
    classified.kind,
    classified.fingerprint,
    classified.severity,
    normalized,
  );
  return true;
}
