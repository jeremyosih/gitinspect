import {
  GitHubFsError,
  type GitHubBlobResponse,
  type GitHubContentResponse,
  type GitHubTreeResponse,
} from "./types.js";

export interface GitHubClientOptions {
  owner: string;
  repo: string;
  ref: string;
  token?: string;
  baseUrl: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}

interface GitHubCommitResponse {
  tree: {
    sha: string;
  };
}

interface GitHubRefResponse {
  object: {
    sha: string;
    type: string;
  };
}

interface GitHubResolvedCommitRef extends GitHubRefResponse {
  _commit: GitHubCommitResponse;
}

export class GitHubClient {
  private readonly owner: string;
  private readonly repo: string;
  private readonly ref: string;
  private readonly token?: string;
  private readonly baseUrl: string;
  rateLimit: RateLimitInfo | null = null;

  constructor(options: GitHubClientOptions) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.ref = options.ref;
    this.token = options.token;
    this.baseUrl = options.baseUrl;
  }

  async fetchContents(path: string): Promise<GitHubContentResponse | GitHubContentResponse[]> {
    const normalized = normalizePath(path);
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${normalized}?ref=${encodeURIComponent(this.ref)}`;
    return this.request<GitHubContentResponse | GitHubContentResponse[]>(url, path);
  }

  async fetchRaw(path: string): Promise<string> {
    const normalized = normalizePath(path);
    const url = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.ref}/${normalized}`;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw this.httpError(res.status, path);
    }
    return res.text();
  }

  async fetchRawBuffer(path: string): Promise<Uint8Array> {
    const normalized = normalizePath(path);
    const url = `https://raw.githubusercontent.com/${this.owner}/${this.repo}/${this.ref}/${normalized}`;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw this.httpError(res.status, path);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  async fetchTree(): Promise<GitHubTreeResponse> {
    // First, resolve the ref to a commit SHA, then get its tree
    const encodedRef = this.ref.split("/").map(encodeURIComponent).join("/");
    const refData = await this.request<GitHubRefResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/ref/heads/${encodedRef}`,
      this.ref,
    ).catch(async (): Promise<GitHubRefResponse> => {
      // Try as a tag
      return this.request<GitHubRefResponse>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/ref/tags/${encodedRef}`,
        this.ref,
      );
    }).catch(async (): Promise<GitHubResolvedCommitRef> => {
      // Try as a direct commit SHA — get the commit directly
      const commit = await this.request<GitHubCommitResponse>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/commits/${encodeURIComponent(this.ref)}`,
        this.ref,
      );
      return { object: { sha: this.ref, type: "commit" }, _commit: commit };
    });

    let treeSha: string;
    if ("_commit" in refData) {
      treeSha = refData._commit.tree.sha;
    } else if (refData.object.type === "commit") {
      const commit = await this.request<GitHubCommitResponse>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/commits/${refData.object.sha}`,
        this.ref,
      );
      treeSha = commit.tree.sha;
    } else {
      // Tag pointing to a commit
      const tag = await this.request<{ object: { sha: string } }>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/tags/${refData.object.sha}`,
        this.ref,
      );
      const commit = await this.request<{ tree: { sha: string } }>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/commits/${tag.object.sha}`,
        this.ref,
      );
      treeSha = commit.tree.sha;
    }

    return this.request<GitHubTreeResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/trees/${treeSha}?recursive=1`,
      "/",
    );
  }

  async fetchBlob(sha: string): Promise<GitHubBlobResponse> {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/blobs/${sha}`;
    return this.request<GitHubBlobResponse>(url, sha);
  }

  private async request<T>(url: string, pathForError: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, { headers });
    this.updateRateLimit(res);

    if (!res.ok) {
      throw this.httpError(res.status, pathForError);
    }

    return res.json() as Promise<T>;
  }

  private updateRateLimit(res: Response): void {
    const limit = res.headers.get("x-ratelimit-limit");
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");

    if (limit && remaining && reset) {
      this.rateLimit = {
        limit: parseInt(limit, 10),
        remaining: parseInt(remaining, 10),
        reset: new Date(parseInt(reset, 10) * 1000),
      };
    }
  }

  private httpError(status: number, path: string): GitHubFsError {
    if (status === 403 && this.rateLimit && this.rateLimit.remaining === 0) {
      const resetAt = this.rateLimit.reset.toLocaleTimeString();
      return new GitHubFsError("EACCES", `GitHub API rate limit exceeded (resets at ${resetAt}): ${path}`, path);
    }
    switch (status) {
      case 404:
        return new GitHubFsError("ENOENT", `No such file or directory: ${path}`, path);
      case 403:
        return new GitHubFsError("EACCES", `Permission denied: ${path}`, path);
      case 401:
        return new GitHubFsError("EACCES", `Authentication required: ${path}`, path);
      default:
        return new GitHubFsError("EIO", `GitHub API error (${status}): ${path}`, path);
    }
  }
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}
