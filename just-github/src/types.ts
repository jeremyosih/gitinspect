export interface GitHubFsOptions {
  owner: string;
  repo: string;
  ref?: string;
  token?: string;
  baseUrl?: string;
  cache?: CacheOptions;
}

export interface CacheOptions {
  treeTtlMs?: number;
  contentMaxBytes?: number;
  contentMaxEntries?: number;
  enabled?: boolean;
}

export interface FileStat {
  type: "file" | "dir" | "symlink";
  size: number;
  sha: string;
}

export interface DirEntry {
  name: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  sha: string;
}

// GitHub API response types

export interface GitHubTreeResponse {
  sha: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export interface GitHubContentResponse {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "file" | "dir" | "symlink" | "submodule";
  content?: string;
  encoding?: string;
  target?: string;
  download_url: string | null;
}

export interface GitHubBlobResponse {
  sha: string;
  size: number;
  content: string;
  encoding: "base64" | "utf-8";
}

export class GitHubFsError extends Error {
  constructor(
    public code: string,
    message: string,
    public path?: string,
  ) {
    super(message);
    this.name = "GitHubFsError";
  }
}

export interface TreeLoadWarning {
  message: string;
  type: "truncated-tree";
}
