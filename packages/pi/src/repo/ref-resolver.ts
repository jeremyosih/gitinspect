import { readGitHubErrorMessage, toGitHubFsError } from "@gitinspect/just-github/github-http";
import { GitHubFsError } from "@gitinspect/just-github/types";
import type { ResolvedRepoRef } from "@gitinspect/db";
import { githubApiFetch } from "@gitinspect/pi/repo/github-fetch";
import type { RepoPathIntent, ResolvedRepoLocation } from "@gitinspect/pi/repo/path-intent";
import {
  createBranchRepoRef,
  createCommitRepoRef,
  createTagRepoRef,
  displayResolvedRepoRef,
} from "@gitinspect/pi/repo/refs";

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

type GitHubCommitLookup = {
  sha: string;
};

type GitHubGitRefLookup = {
  object: {
    sha: string;
    type: string;
  };
};

type GitHubRepositoryPayload = {
  default_branch?: string;
};

type ResolvedTail = {
  resolvedRef: ResolvedRepoRef;
  subpath?: string;
};

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requireTrimmed(value: string | undefined, field: string): string {
  const trimmed = trimToUndefined(value);
  if (!trimmed) {
    throw new Error(`A repository ${field} is required`);
  }
  return trimmed;
}

function createRepoRefNotFoundError(path: string): GitHubFsError {
  return new GitHubFsError({
    code: "ENOENT",
    isRetryable: false,
    kind: "not_found",
    message: `GitHub ref not found: ${path}`,
    path,
  });
}

async function throwGitHubResponseError(response: Response, path: string): Promise<never> {
  throw toGitHubFsError(response, path, await readGitHubErrorMessage(response));
}

async function requestGitHubJson<T>(path: string, pathForError: string): Promise<T> {
  const response = await githubApiFetch(path, { access: "repo" });
  if (!response.ok) {
    await throwGitHubResponseError(response, pathForError);
  }
  return (await response.json()) as T;
}

async function requestGitHubJsonOrUndefined<T>(
  path: string,
  pathForError: string,
  allowedMissingStatuses: readonly number[] = [404],
): Promise<T | undefined> {
  const response = await githubApiFetch(path, { access: "repo" });
  if (allowedMissingStatuses.includes(response.status)) {
    return undefined;
  }
  if (!response.ok) {
    await throwGitHubResponseError(response, pathForError);
  }
  return (await response.json()) as T;
}

async function fetchDefaultBranch(owner: string, repo: string): Promise<string> {
  const payload = await requestGitHubJson<GitHubRepositoryPayload>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    `/${owner}/${repo}`,
  );
  const defaultBranch = trimToUndefined(payload.default_branch);
  if (!defaultBranch) {
    throw new Error(`Repository ${owner}/${repo} does not expose a default branch`);
  }
  return defaultBranch;
}

async function lookupCommitByRef(
  owner: string,
  repo: string,
  ref: string,
): Promise<GitHubCommitLookup | undefined> {
  return await requestGitHubJsonOrUndefined<GitHubCommitLookup>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`,
    ref,
    [404, 422],
  );
}

async function lookupGitRef(
  owner: string,
  repo: string,
  namespace: "heads" | "tags",
  name: string,
): Promise<GitHubGitRefLookup | undefined> {
  return await requestGitHubJsonOrUndefined<GitHubGitRefLookup>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/${namespace}/${encodeURIComponent(name)}`,
    name,
    [404],
  );
}

async function lookupBranch(owner: string, repo: string, name: string): Promise<boolean> {
  return (await lookupGitRef(owner, repo, "heads", name)) !== undefined;
}

async function lookupTag(owner: string, repo: string, name: string): Promise<boolean> {
  return (await lookupGitRef(owner, repo, "tags", name)) !== undefined;
}

async function lookupCommit(owner: string, repo: string, sha: string): Promise<string | undefined> {
  const commit = await lookupCommitByRef(owner, repo, sha);
  return commit?.sha;
}

async function resolveExplicitRef(
  owner: string,
  repo: string,
  rawRef: string,
): Promise<ResolvedRepoRef> {
  const input = requireTrimmed(rawRef, "ref");

  if (input.startsWith("refs/heads/")) {
    const name = input.slice("refs/heads/".length);
    if (await lookupBranch(owner, repo, name)) {
      return createBranchRepoRef(name);
    }
  }

  if (input.startsWith("refs/tags/")) {
    const name = input.slice("refs/tags/".length);
    if (await lookupTag(owner, repo, name)) {
      return createTagRepoRef(name);
    }
  }

  if (input.startsWith("heads/")) {
    const name = input.slice("heads/".length);
    if (await lookupBranch(owner, repo, name)) {
      return createBranchRepoRef(name);
    }
  }

  if (input.startsWith("tags/")) {
    const name = input.slice("tags/".length);
    if (await lookupTag(owner, repo, name)) {
      return createTagRepoRef(name);
    }
  }

  if (FULL_COMMIT_SHA_PATTERN.test(input)) {
    const sha = await lookupCommit(owner, repo, input);
    if (sha) {
      return createCommitRepoRef(sha);
    }
  }

  if (await lookupBranch(owner, repo, input)) {
    return createBranchRepoRef(input);
  }

  if (await lookupTag(owner, repo, input)) {
    return createTagRepoRef(input);
  }

  const sha = await lookupCommit(owner, repo, input);
  if (sha) {
    return createCommitRepoRef(sha);
  }

  throw createRepoRefNotFoundError(input);
}

async function resolveTailAsRef(owner: string, repo: string, tail: string): Promise<ResolvedTail> {
  const segments = tail
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (let index = segments.length; index >= 1; index -= 1) {
    const candidate = segments.slice(0, index).join("/");
    const remaining = segments.slice(index).join("/") || undefined;

    if (await lookupBranch(owner, repo, candidate)) {
      return {
        resolvedRef: createBranchRepoRef(candidate),
        subpath: remaining,
      };
    }

    if (await lookupTag(owner, repo, candidate)) {
      return {
        resolvedRef: createTagRepoRef(candidate),
        subpath: remaining,
      };
    }
  }

  const firstSegment = segments[0];
  if (firstSegment && FULL_COMMIT_SHA_PATTERN.test(firstSegment)) {
    const sha = await lookupCommit(owner, repo, firstSegment);
    if (sha) {
      return {
        resolvedRef: createCommitRepoRef(sha),
        subpath: segments.slice(1).join("/") || undefined,
      };
    }
  }

  throw createRepoRefNotFoundError(tail);
}

export async function resolveGitHubRef(
  owner: string,
  repo: string,
  raw: string,
): Promise<ResolvedRepoRef> {
  return await resolveExplicitRef(owner, repo, raw);
}

export async function resolveRepoIntent(intent: RepoPathIntent): Promise<ResolvedRepoLocation> {
  switch (intent.type) {
    case "invalid":
      throw new Error(intent.reason);

    case "repo-root": {
      const branch = await fetchDefaultBranch(intent.owner, intent.repo);
      const resolvedRef = await resolveExplicitRef(intent.owner, intent.repo, branch);
      return {
        owner: intent.owner,
        repo: intent.repo,
        ref: displayResolvedRepoRef(resolvedRef),
        refOrigin: "default",
        resolvedRef,
        view: "repo",
      };
    }

    case "shorthand-ref": {
      const resolvedRef = await resolveExplicitRef(intent.owner, intent.repo, intent.rawRef);
      return {
        owner: intent.owner,
        repo: intent.repo,
        ref: displayResolvedRepoRef(resolvedRef),
        refOrigin: "explicit",
        resolvedRef,
        view: "repo",
      };
    }

    case "commit-page": {
      const resolvedRef = await resolveExplicitRef(intent.owner, intent.repo, intent.sha);
      return {
        owner: intent.owner,
        repo: intent.repo,
        ref: displayResolvedRepoRef(resolvedRef),
        refOrigin: "explicit",
        resolvedRef,
        view: "repo",
      };
    }

    case "tree-page": {
      const result = await resolveTailAsRef(intent.owner, intent.repo, intent.tail);
      return {
        owner: intent.owner,
        repo: intent.repo,
        ref: displayResolvedRepoRef(result.resolvedRef),
        refOrigin: "explicit",
        resolvedRef: result.resolvedRef,
        subpath: result.subpath,
        view: "tree",
      };
    }

    case "blob-page": {
      const result = await resolveTailAsRef(intent.owner, intent.repo, intent.tail);
      return {
        owner: intent.owner,
        repo: intent.repo,
        ref: displayResolvedRepoRef(result.resolvedRef),
        refOrigin: "explicit",
        resolvedRef: result.resolvedRef,
        subpath: result.subpath,
        view: "blob",
      };
    }

    case "unsupported-repo-page": {
      const branch = await fetchDefaultBranch(intent.owner, intent.repo);
      const resolvedRef = await resolveExplicitRef(intent.owner, intent.repo, branch);
      return {
        owner: intent.owner,
        repo: intent.repo,
        ref: displayResolvedRepoRef(resolvedRef),
        refOrigin: "default",
        resolvedRef,
        fallbackReason: "unsupported-page",
        view: "repo",
      };
    }
  }
}
