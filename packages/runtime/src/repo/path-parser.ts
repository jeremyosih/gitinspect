import type { RepoPathIntent } from "@gitinspect/runtime/repo/path-intent";

export const RESERVED_ROOT_SEGMENTS = new Set(["auth", "chat", "api"]);

/** True when `segment` is reserved for app routes (e.g. /chat) and must not be treated as a GitHub org/user slug. */
export function isReservedRootOwnerSegment(segment: string): boolean {
  return RESERVED_ROOT_SEGMENTS.has(segment.trim().toLowerCase());
}
const UNSUPPORTED_REPO_PAGES = new Set([
  "actions",
  "activity",
  "archive",
  "branches",
  "commits",
  "community",
  "compare",
  "contributors",
  "custom-properties",
  "dependabot",
  "discussions",
  "edit",
  "forks",
  "graphs",
  "insights",
  "issues",
  "issues-new",
  "labels",
  "marketplace",
  "milestones",
  "network",
  "new",
  "packages",
  "projects",
  "pull",
  "pulls",
  "pulse",
  "releases",
  "search",
  "security",
  "settings",
  "stargazers",
  "tags",
  "watchers",
  "wiki",
]);

const SEGMENT_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripDotGit(repo: string): string {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

function isValidSegment(segment: string): boolean {
  if (!segment || segment.length > 200) {
    return false;
  }

  if (segment === "." || segment === "..") {
    return false;
  }

  return SEGMENT_PATTERN.test(segment);
}

function normalizeUrlLikeInput(raw: string): string {
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  return `https://${raw}`;
}

export function parseRepoRoutePath(pathname: string): RepoPathIntent {
  const raw = pathname.trim();
  if (!raw || raw === "/") {
    return { type: "invalid", reason: "Missing owner/repo" };
  }

  const segments = raw
    .split("/")
    .map((segment) => decodePathSegment(segment.trim()))
    .filter(Boolean);

  if (segments.length < 2) {
    return { type: "invalid", reason: "Missing owner/repo" };
  }

  const owner = segments[0];
  const repo = stripDotGit(segments[1] ?? "");

  if (!owner || !repo) {
    return { type: "invalid", reason: "Missing owner or repo" };
  }

  if (RESERVED_ROOT_SEGMENTS.has(owner)) {
    return { type: "invalid", reason: `Reserved root path: ${owner}` };
  }

  if (!isValidSegment(owner) || !isValidSegment(repo)) {
    return { type: "invalid", reason: "Invalid owner or repo" };
  }

  if (segments.length === 2) {
    return { type: "repo-root", owner, repo };
  }

  const third = segments[2];
  if (!third) {
    return { type: "repo-root", owner, repo };
  }

  if (third === "tree") {
    const tail = segments.slice(3).join("/");
    return tail ? { type: "tree-page", owner, repo, tail } : { type: "repo-root", owner, repo };
  }

  if (third === "blob") {
    const tail = segments.slice(3).join("/");
    return tail ? { type: "blob-page", owner, repo, tail } : { type: "repo-root", owner, repo };
  }

  if (third === "commit") {
    const sha = segments[3]?.trim();
    return sha ? { type: "commit-page", owner, repo, sha } : { type: "repo-root", owner, repo };
  }

  if (UNSUPPORTED_REPO_PAGES.has(third)) {
    return { type: "unsupported-repo-page", owner, page: third, repo };
  }

  if (segments.length === 3) {
    return { type: "shorthand-ref", owner, repo, rawRef: third };
  }

  return { type: "invalid", reason: `Unrecognized repo path: ${pathname}` };
}

export function parseRepoInput(raw: string): RepoPathIntent {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { type: "invalid", reason: "Empty repository input" };
  }

  const slashSegments = trimmed.split("/").filter(Boolean);
  if (
    slashSegments.length === 2 &&
    !trimmed.includes(" ") &&
    !trimmed.includes("://") &&
    !trimmed.startsWith("github.com/")
  ) {
    return parseRepoRoutePath(`/${slashSegments[0]}/${slashSegments[1]}`);
  }

  try {
    const url = new URL(normalizeUrlLikeInput(trimmed));
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return { type: "invalid", reason: `Unsupported host: ${url.hostname}` };
    }

    return parseRepoRoutePath(url.pathname);
  } catch {
    return { type: "invalid", reason: `Invalid repository input: ${trimmed}` };
  }
}
