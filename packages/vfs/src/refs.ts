export type GitHubResolvedRef =
  | {
      apiRef: `heads/${string}`;
      fullRef: `refs/heads/${string}`;
      kind: "branch";
      name: string;
    }
  | {
      apiRef: `tags/${string}`;
      fullRef: `refs/tags/${string}`;
      kind: "tag";
      name: string;
    }
  | {
      kind: "commit";
      sha: string;
    };

export function displayResolvedRef(ref: GitHubResolvedRef): string {
  if (ref.kind === "commit") {
    return ref.sha;
  }

  return ref.name;
}

export function toCommitApiRef(ref: GitHubResolvedRef): string {
  return ref.kind === "commit" ? ref.sha : ref.apiRef;
}
