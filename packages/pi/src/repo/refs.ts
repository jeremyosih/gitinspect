import type { ResolvedRepoRef } from "@gitinspect/db";

export function createBranchRepoRef(name: string): ResolvedRepoRef {
  return {
    apiRef: `heads/${name}`,
    fullRef: `refs/heads/${name}`,
    kind: "branch",
    name,
  };
}

export function createCommitRepoRef(sha: string): ResolvedRepoRef {
  return {
    kind: "commit",
    sha,
  };
}

export function createTagRepoRef(name: string): ResolvedRepoRef {
  return {
    apiRef: `tags/${name}`,
    fullRef: `refs/tags/${name}`,
    kind: "tag",
    name,
  };
}

export function displayResolvedRepoRef(ref: ResolvedRepoRef): string {
  if (ref.kind === "commit") {
    return ref.sha;
  }

  return ref.name;
}
