import type { RepoRefOrigin, ResolvedRepoRef, ResolvedRepoSource } from "@gitinspect/db";

export type RepoPathIntent =
  | {
      type: "repo-root";
      owner: string;
      repo: string;
    }
  | {
      type: "shorthand-ref";
      owner: string;
      repo: string;
      rawRef: string;
    }
  | {
      type: "commit-page";
      owner: string;
      repo: string;
      sha: string;
    }
  | {
      type: "tree-page";
      owner: string;
      repo: string;
      tail: string;
    }
  | {
      type: "blob-page";
      owner: string;
      repo: string;
      tail: string;
    }
  | {
      type: "unsupported-repo-page";
      owner: string;
      repo: string;
      page: string;
    }
  | {
      type: "invalid";
      reason: string;
    };

export type ResolvedRepoLocation = {
  owner: string;
  repo: string;
  refOrigin: RepoRefOrigin;
  resolvedRef: ResolvedRepoRef;
  ref: string;
  fallbackReason?: "unsupported-page";
  view: "repo" | "tree" | "blob";
  subpath?: string;
};

export function toResolvedRepoSource(location: ResolvedRepoLocation): ResolvedRepoSource {
  return {
    owner: location.owner,
    ref: location.ref,
    refOrigin: location.refOrigin,
    repo: location.repo,
    resolvedRef: location.resolvedRef,
  };
}
