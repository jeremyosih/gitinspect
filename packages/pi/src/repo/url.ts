import type { ResolvedRepoRef, ResolvedRepoSource } from "@gitinspect/db";

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function encodePathSegments(path: string | undefined): string {
  return (
    path
      ?.trim()
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/") ?? ""
  );
}

function buildRepoPathname(owner: string, repo: string, path?: string): string {
  const encodedOwner = encodeURIComponent(owner.trim());
  const encodedRepo = encodeURIComponent(repo.trim());
  const encodedPath = encodePathSegments(path);

  return encodedPath
    ? `/${encodedOwner}/${encodedRepo}/${encodedPath}`
    : `/${encodedOwner}/${encodedRepo}`;
}

function isCommitRef(ref: string, resolvedRef?: ResolvedRepoRef): boolean {
  return resolvedRef?.kind === "commit" || FULL_COMMIT_SHA_PATTERN.test(ref);
}

export function repoSourceToPath(
  source: Pick<ResolvedRepoSource, "owner" | "repo" | "ref" | "refOrigin"> & {
    resolvedRef?: ResolvedRepoRef;
  },
): string {
  if (source.refOrigin === "default") {
    return buildRepoPathname(source.owner, source.repo);
  }

  if (isCommitRef(source.ref, source.resolvedRef)) {
    return buildRepoPathname(source.owner, source.repo, `commit/${source.ref}`);
  }

  return buildRepoPathname(source.owner, source.repo, `tree/${source.ref}`);
}

export function githubRepoUrl(owner: string, repo: string): string {
  return `https://github.com/${encodeURIComponent(owner.trim())}/${encodeURIComponent(repo.trim())}`;
}

export function githubRepoPathUrl(owner: string, repo: string, path?: string): string {
  const encodedPath = encodePathSegments(path);
  const baseUrl = githubRepoUrl(owner, repo);
  return encodedPath ? `${baseUrl}/${encodedPath}` : baseUrl;
}

export function repoSourceToGitHubUrl(
  source: Pick<ResolvedRepoSource, "owner" | "repo" | "ref" | "refOrigin" | "resolvedRef">,
): string {
  if (source.refOrigin === "default") {
    return githubRepoUrl(source.owner, source.repo);
  }

  if (source.resolvedRef.kind === "commit") {
    return githubRepoPathUrl(source.owner, source.repo, `commit/${source.resolvedRef.sha}`);
  }

  return githubRepoPathUrl(source.owner, source.repo, `tree/${source.ref}`);
}

export function githubOwnerAvatarUrl(owner: string): string {
  return `https://github.com/${encodeURIComponent(owner)}.png`;
}
