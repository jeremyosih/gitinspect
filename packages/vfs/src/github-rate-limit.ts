import { readGitHubErrorMessage } from "./github-http.js";

export type GitHubRateLimitKind = "primary" | "secondary" | "unknown";

export interface ParsedGitHubRateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}

export interface GitHubRateLimitResponseDetails {
  info: ParsedGitHubRateLimitInfo | null;
  kind: GitHubRateLimitKind;
  retryAtMs?: number;
}

export function parseGitHubRateLimitInfo(res: Response): ParsedGitHubRateLimitInfo | null {
  const limit = parsePositiveInt(res.headers.get("x-ratelimit-limit"));
  const remaining = parsePositiveInt(res.headers.get("x-ratelimit-remaining"));
  const resetAtSeconds = parsePositiveInt(res.headers.get("x-ratelimit-reset"));

  if (limit === undefined || remaining === undefined || resetAtSeconds === undefined) {
    return null;
  }

  return {
    limit,
    remaining,
    reset: new Date(resetAtSeconds * 1000),
  };
}

export async function getGitHubRateLimitResponseDetails(
  res: Response,
): Promise<GitHubRateLimitResponseDetails | undefined> {
  const info = parseGitHubRateLimitInfo(res);
  const retryAfterSeconds = parsePositiveInt(res.headers.get("retry-after"));
  const detail = await readGitHubErrorMessage(res);

  if (!isRateLimitedResponse(res, detail, info, retryAfterSeconds)) {
    return undefined;
  }

  const lower = detail?.toLowerCase();
  const kind: GitHubRateLimitKind =
    info?.remaining === 0
      ? "primary"
      : lower?.includes("secondary rate limit") || retryAfterSeconds !== undefined
        ? "secondary"
        : "unknown";

  return {
    info,
    kind,
    retryAtMs:
      retryAfterSeconds !== undefined
        ? Date.now() + retryAfterSeconds * 1000
        : info?.remaining === 0
          ? info.reset.getTime()
          : undefined,
  };
}

function isRateLimitedResponse(
  res: Response,
  detail: string | undefined,
  info: ParsedGitHubRateLimitInfo | null,
  retryAfterSeconds: number | undefined,
): boolean {
  if (res.status === 429) {
    return true;
  }

  if (res.status !== 403) {
    return false;
  }

  if (retryAfterSeconds !== undefined) {
    return true;
  }

  if (info?.remaining === 0) {
    return true;
  }

  return detail?.toLowerCase().includes("rate limit") === true;
}

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
