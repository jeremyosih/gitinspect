import { toast } from "sonner";
import { env as webEnv } from "@gitinspect/env/web";
import {
  parseGitHubRateLimitInfo,
  type GitHubRateLimitKind,
} from "@gitinspect/vfs/github-rate-limit";
import {
  readGitHubErrorMessage,
  shouldRetryUnauthenticated,
  stripAuthorization,
} from "@gitinspect/vfs/github-http";
import { classifyRuntimeError } from "@gitinspect/runtime/agent/runtime-errors";
import {
  getGitHubNoticeCta,
  resolveRegisteredGitHubRequestAuth,
  type GitHubAuthState,
  type GitHubRequestAccess,
  type GitHubResolvedRequestAuth,
} from "@gitinspect/runtime/repo/github-access";
import { getGitHubAuthUiBridge } from "@gitinspect/runtime/repo/github-auth-ui";
import { appendSessionNotice } from "@gitinspect/runtime/sessions/session-notices";
import type { SystemMessage } from "@gitinspect/runtime/types/chat";

const CACHE_NAME = "github-api";
const FRESH_MS = 2 * 60 * 1000;
const STALE_MS = 10 * 60 * 1000;
const TIMESTAMP_HEADER = "x-cached-at";
const TOAST_DEDUPE_MS = 5 * 1000;
const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_PROXY_BASE_PATH = "/api/github";
const PROXY_REPO_UNSUPPORTED_ERROR = "Proxy transport only supports public GitHub requests in v1.";

export type GitHubTransport = "auto" | "direct" | "proxy";

type GitHubExecutionPlan =
  | { transport: "proxy" }
  | { auth: GitHubResolvedRequestAuth; transport: "direct" };

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

function getRequestAuthToken(auth: GitHubResolvedRequestAuth): string | undefined {
  if (auth.mode === "anon") {
    return undefined;
  }

  return auth.token;
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

function classifyRateLimitKind(
  response: Response,
  detail: string | undefined,
): GitHubRateLimitKind {
  const info = parseGitHubRateLimitInfo(response);
  const retryAfter = response.headers.get("retry-after");
  const lower = detail?.toLowerCase();

  if (info?.remaining === 0) {
    return "primary";
  }

  if (retryAfter || lower?.includes("secondary rate limit")) {
    return "secondary";
  }

  return "unknown";
}

function parseRetryAfterMs(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after");

  if (!retryAfter) {
    return undefined;
  }

  const retryAfterSeconds = Number.parseInt(retryAfter, 10);
  if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) {
    return undefined;
  }

  return Date.now() + retryAfterSeconds * 1000;
}

async function toRateLimitError(response: Response): Promise<GitHubRateLimitError> {
  const detail = await readGitHubErrorMessage(response);
  const info = parseGitHubRateLimitInfo(response);
  const blockedUntilMs = parseRetryAfterMs(response) ?? info?.reset.getTime();

  return new GitHubRateLimitError({
    blockedUntilMs,
    kind: classifyRateLimitKind(response, detail),
    status: response.status,
  });
}

async function throwIfRateLimited(response: Response): Promise<void> {
  const detail = await readGitHubErrorMessage(response);
  const info = parseGitHubRateLimitInfo(response);
  const isRateLimited =
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.has("retry-after") ||
        info?.remaining === 0 ||
        detail?.toLowerCase().includes("rate limit") === true));

  if (isRateLimited) {
    throw await toRateLimitError(response);
  }
}

function shouldUseGitHubCache(access: GitHubRequestAccess): boolean {
  return access === "public" && typeof caches !== "undefined";
}

function buildCacheKey(path: string): string {
  return `${GITHUB_API_BASE_URL}${path}`;
}

function buildProxyRequestUrl(path: string): string {
  return `${GITHUB_PROXY_BASE_PATH}${path}`;
}

function getProxyEnabled(): boolean {
  return webEnv.VITE_GITHUB_PROXY_ENABLED;
}

async function resolveGitHubExecutionPlan(input: {
  access: GitHubRequestAccess;
  proxyEnabled: boolean;
  transport?: GitHubTransport;
}): Promise<GitHubExecutionPlan> {
  const access = input.access;
  const transport = input.transport ?? "auto";

  if (transport === "proxy") {
    if (access === "repo") {
      throw new Error(PROXY_REPO_UNSUPPORTED_ERROR);
    }

    return { transport: "proxy" };
  }

  const auth = await resolveRegisteredGitHubRequestAuth(access);

  if (transport === "direct") {
    return { auth, transport: "direct" };
  }

  if (auth.mode !== "anon") {
    return { auth, transport: "direct" };
  }

  if (access === "public" && input.proxyEnabled) {
    return { transport: "proxy" };
  }

  return { auth, transport: "direct" };
}

async function executeDirectGitHubRequest(
  path: string,
  auth: GitHubResolvedRequestAuth,
  signal?: AbortSignal,
): Promise<Response> {
  const url = `${GITHUB_API_BASE_URL}${path}`;
  const token = getRequestAuthToken(auth);
  const headers = buildGithubHeaders(token);
  const response = await fetch(url, {
    headers,
    signal,
  });

  if (!response.ok && token) {
    const detail = await readGitHubErrorMessage(response);

    if (shouldRetryUnauthenticated(response, detail)) {
      const fallback = await fetch(url, {
        headers: stripAuthorization(headers),
        signal,
      });

      await throwIfRateLimited(fallback);

      if (fallback.ok) {
        return fallback;
      }
    }
  }

  await throwIfRateLimited(response);
  return response;
}

async function executeProxyGitHubRequest(path: string, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(buildProxyRequestUrl(path), {
    headers: buildGithubHeaders(undefined),
    signal,
  });

  await throwIfRateLimited(response);
  return response;
}

async function executeGitHubRequest(
  path: string,
  plan: GitHubExecutionPlan,
  signal?: AbortSignal,
): Promise<Response> {
  if (plan.transport === "proxy") {
    return await executeProxyGitHubRequest(path, signal);
  }

  return await executeDirectGitHubRequest(path, plan.auth, signal);
}

async function putCache(cache: Cache, cacheKey: string, response: Response): Promise<void> {
  const body = await response.clone().arrayBuffer();
  const cached = new Response(body, {
    headers: new Headers(response.headers),
    status: response.status,
    statusText: response.statusText,
  });
  cached.headers.set(TIMESTAMP_HEADER, Date.now().toString());
  await cache.put(cacheKey, cached);
}

function revalidateInBackground(input: {
  access: GitHubRequestAccess;
  cache: Cache;
  cacheKey: string;
  path: string;
  transport?: GitHubTransport;
}): void {
  void resolveGitHubExecutionPlan({
    access: input.access,
    proxyEnabled: getProxyEnabled(),
    transport: input.transport,
  })
    .then(async (plan) => await executeGitHubRequest(input.path, plan))
    .then(async (response) => {
      if (response.ok) {
        await putCache(input.cache, input.cacheKey, response);
      }
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
  options?: {
    access?: GitHubRequestAccess;
    signal?: AbortSignal;
    transport?: GitHubTransport;
  },
): Promise<Response> {
  const access = options?.access ?? "repo";
  const plan = await resolveGitHubExecutionPlan({
    access,
    proxyEnabled: getProxyEnabled(),
    transport: options?.transport,
  });

  if (!shouldUseGitHubCache(access)) {
    return await executeGitHubRequest(path, plan, options?.signal);
  }

  const cache = await caches.open(CACHE_NAME);
  const cacheKey = buildCacheKey(path);
  const cached = await cache.match(cacheKey);

  if (cached) {
    const cachedAt = Number(cached.headers.get(TIMESTAMP_HEADER) ?? 0);
    const age = Date.now() - cachedAt;

    if (age < FRESH_MS) {
      return cached;
    }

    if (age < STALE_MS) {
      revalidateInBackground({
        access,
        cache,
        cacheKey,
        path,
        transport: options?.transport,
      });
      return cached;
    }
  }

  try {
    const response = await executeGitHubRequest(path, plan, options?.signal);

    if (response.ok) {
      await putCache(cache, cacheKey, response);
    }

    return response;
  } catch (error) {
    if (cached && isRateLimitError(error)) {
      return cached;
    }

    throw error;
  }
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
        ? `GitHub requests are rate limited until ${retryAt}. Sign in to raise limits or keep using your local token.`
        : "GitHub requests are rate limited right now. Sign in to raise limits or keep using your local token.",
      onAction: action.onAction,
      signature,
    });
    return;
  }

  if (kind === "github_auth") {
    const action = getGithubToastAction(kind);

    showGithubActionToast({
      actionLabel: action.label,
      message:
        "Your GitHub session needs attention. Fix the connection to keep using private repos, or use your local token.",
      onAction: action.onAction,
      signature,
    });
    return;
  }

  if (kind === "github_permission") {
    const action = getGithubToastAction(kind);

    showGithubActionToast({
      actionLabel: action.label,
      message: "Private repo access is not enabled yet. Approve it in GitHub or use a local token.",
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
      message: "GitHub request failed. Check your GitHub connection or switch to your local token.",
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
