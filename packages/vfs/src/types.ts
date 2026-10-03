import type { GitHubRateLimitKind } from "./github-rate-limit.js";
import type { GitHubResolvedRef } from "./refs.js";

export interface GitHubFsOptions {
  owner: string;
  repo: string;
  ref: GitHubResolvedRef;
  token?: string;
  getToken?: () => Promise<string | undefined>;
  baseUrl?: string;
  cache?: CacheOptions;
  maxFileBytes?: number;
  maxConcurrency?: number;
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

export type GitHubErrorKind =
  | "not_found"
  | "auth"
  | "permission"
  | "rate_limit"
  | "conflict"
  | "validation"
  | "unsupported"
  | "network"
  | "unknown";

export class GitHubFsError extends Error {
  code: string;
  kind: GitHubErrorKind;
  path?: string;
  status?: number;
  githubMessage?: string;
  rateLimitKind?: GitHubRateLimitKind;
  retryAt?: number;
  isRetryable?: boolean;

  constructor(options: {
    code: string;
    message: string;
    path?: string;
    kind: GitHubErrorKind;
    status?: number;
    githubMessage?: string;
    rateLimitKind?: GitHubRateLimitKind;
    retryAt?: number;
    isRetryable?: boolean;
    cause?: unknown;
  });
  constructor(code: string, message: string, path?: string);
  constructor(
    input:
      | {
          code: string;
          message: string;
          path?: string;
          kind: GitHubErrorKind;
          status?: number;
          githubMessage?: string;
          rateLimitKind?: GitHubRateLimitKind;
          retryAt?: number;
          isRetryable?: boolean;
          cause?: unknown;
        }
      | string,
    legacyMessage?: string,
    legacyPath?: string,
  ) {
    const options =
      typeof input === "string"
        ? {
            code: input,
            isRetryable: input === "EIO",
            kind: kindFromLegacyCode(input),
            message: legacyMessage ?? input,
            path: legacyPath,
          }
        : input;

    super(options.message, options.cause ? { cause: options.cause } : undefined);
    this.name = "GitHubFsError";
    this.code = options.code;
    this.kind = options.kind;
    this.path = options.path;
    this.status = options.status;
    this.githubMessage = options.githubMessage;
    this.rateLimitKind = options.rateLimitKind;
    this.retryAt = options.retryAt;
    this.isRetryable = options.isRetryable;
  }
}

function kindFromLegacyCode(code: string): GitHubErrorKind {
  switch (code) {
    case "ENOENT":
      return "not_found";
    case "EACCES":
      return "permission";
    case "EINVAL":
      return "validation";
    case "ENOTSUP":
    case "EFBIG":
    case "EROFS":
    case "EISDIR":
    case "ENOTDIR":
      return "unsupported";
    default:
      return "unknown";
  }
}

export interface TreeLoadWarning {
  message: string;
  type: "truncated-tree";
}
