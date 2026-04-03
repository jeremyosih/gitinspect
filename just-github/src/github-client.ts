import {
  GitHubFsError,
  type GitHubBlobResponse,
  type GitHubContentResponse,
  type GitHubTreeResponse,
} from "./types.js";
import { displayResolvedRef, type GitHubResolvedRef } from "./refs.js";
import { GitHubRateLimitController, parseGitHubRateLimitInfo } from "./github-rate-limit.js";
import {
  readGitHubErrorMessage,
  shouldRetryUnauthenticated,
  stripAuthorization,
  toGitHubFsError,
} from "./github-http.js";

export interface GitHubClientOptions {
  owner: string;
  repo: string;
  ref: GitHubResolvedRef;
  token?: string;
  baseUrl: string;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
}

interface GitHubCommitResponse {
  sha: string;
  commit: {
    tree: {
      sha: string;
    };
  };
}

interface GitHubRefResponse {
  object: {
    sha: string;
    type: string;
  };
}

interface GitHubAnnotatedTagResponse {
  object: {
    sha: string;
    type: string;
  };
}

type GitHubRefNamespace = "heads" | "tags";

export class GitHubClient {
  private readonly owner: string;
  private readonly repo: string;
  private readonly ref: GitHubResolvedRef;
  private readonly token?: string;
  private readonly baseUrl: string;
  private readonly rateLimitController = new GitHubRateLimitController();
  private resolvedCommitPromise?: Promise<GitHubCommitResponse>;
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
    const commit = await this.fetchResolvedCommit();
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${normalized}?ref=${encodeURIComponent(commit.sha)}`;
    return this.request<GitHubContentResponse | GitHubContentResponse[]>(url, path);
  }

  async fetchTree(): Promise<GitHubTreeResponse> {
    const commit = await this.fetchResolvedCommit();

    return this.request<GitHubTreeResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/trees/${commit.commit.tree.sha}?recursive=1`,
      "/",
    );
  }

  async fetchBlob(sha: string): Promise<GitHubBlobResponse> {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/blobs/${sha}`;
    return this.request<GitHubBlobResponse>(url, sha);
  }

  private async fetchResolvedCommit(): Promise<GitHubCommitResponse> {
    if (!this.resolvedCommitPromise) {
      this.resolvedCommitPromise = this.loadResolvedCommit().catch((error: unknown) => {
        this.resolvedCommitPromise = undefined;
        throw error;
      });
    }

    return await this.resolvedCommitPromise;
  }

  private async loadResolvedCommit(): Promise<GitHubCommitResponse> {
    if (this.ref.kind === "commit") {
      return await this.request<GitHubCommitResponse>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(this.ref.sha)}`,
        this.ref.sha,
      );
    }

    const commitSha =
      this.ref.kind === "branch"
        ? await this.fetchRefCommitSha("heads", this.ref.name)
        : await this.fetchTagCommitSha(this.ref.name);

    return await this.request<GitHubCommitResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(commitSha)}`,
      displayResolvedRef(this.ref),
    );
  }

  private async request<T>(url: string, pathForError: string): Promise<T> {
    const res = await this.fetchWithOptionalAnonymousFallback(
      url,
      {
        Accept: "application/vnd.github.v3+json",
        ...this.buildHeaders(),
      },
      pathForError,
    );

    if (!res.ok) {
      throw await this.httpError(res, pathForError);
    }

    return res.json() as Promise<T>;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private async fetchWithOptionalAnonymousFallback(
    url: string,
    headers: Record<string, string>,
    pathForError: string,
  ): Promise<Response> {
    this.throwIfRateLimited(pathForError);

    let response: Response;

    try {
      response = await fetch(url, { headers });
    } catch (error) {
      throw new GitHubFsError({
        cause: error,
        code: "EIO",
        isRetryable: true,
        kind: "network",
        message: `GitHub network error: ${pathForError}`,
        path: pathForError,
      });
    }

    const rateLimitBlock = await this.observeRateLimit(response);
    if (rateLimitBlock) {
      throw this.createRateLimitError(pathForError, rateLimitBlock.blockedUntilMs);
    }

    if (response.ok || !this.token) {
      return response;
    }

    const detail = await readGitHubErrorMessage(response);
    if (!shouldRetryUnauthenticated(response, detail)) {
      return response;
    }

    const fallbackResponse = await fetch(url, {
      headers: stripAuthorization(headers),
    });
    const fallbackRateLimitBlock = await this.observeRateLimit(fallbackResponse);

    if (fallbackRateLimitBlock) {
      return response;
    }

    return fallbackResponse.ok ? fallbackResponse : response;
  }

  private async observeRateLimit(res: Response) {
    const info = parseGitHubRateLimitInfo(res);
    if (info) {
      this.rateLimit = info;
    }

    return await this.rateLimitController.afterResponse(res);
  }

  private throwIfRateLimited(path: string): void {
    const rateLimitBlock = this.rateLimitController.beforeRequest();
    if (!rateLimitBlock) {
      return;
    }

    throw this.createRateLimitError(path, rateLimitBlock.blockedUntilMs);
  }

  private createRateLimitError(path: string, blockedUntilMs: number): GitHubFsError {
    return new GitHubFsError({
      code: "EACCES",
      isRetryable: true,
      kind: "rate_limit",
      message: `GitHub API rate limit exceeded (retry after ${new Date(blockedUntilMs).toLocaleTimeString()}): ${path}`,
      path,
      rateLimitKind: "unknown",
      retryAt: blockedUntilMs,
      status: 429,
    });
  }

  private async httpError(res: Response, path: string): Promise<GitHubFsError> {
    return toGitHubFsError(res, path, await readGitHubErrorMessage(res));
  }

  private async fetchRefCommitSha(namespace: GitHubRefNamespace, name: string): Promise<string> {
    const refData = await this.request<GitHubRefResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/ref/${namespace}/${encodeURIComponent(name)}`,
      name,
    );

    if (refData.object.type === "commit") {
      return refData.object.sha;
    }

    if (namespace === "tags" && refData.object.type === "tag") {
      return await this.fetchTagCommitSha(name, refData);
    }

    throw new GitHubFsError({
      code: "EIO",
      isRetryable: false,
      kind: "unknown",
      message: `GitHub API returned an unexpected ${namespace.slice(0, -1)} target: ${name}`,
      path: name,
    });
  }

  private async fetchTagCommitSha(name: string, refData?: GitHubRefResponse): Promise<string> {
    const tagRef =
      refData ??
      (await this.request<GitHubRefResponse>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/ref/tags/${encodeURIComponent(name)}`,
        name,
      ));

    if (tagRef.object.type === "commit") {
      return tagRef.object.sha;
    }

    if (tagRef.object.type !== "tag") {
      throw new GitHubFsError({
        code: "EIO",
        isRetryable: false,
        kind: "unknown",
        message: `GitHub API returned an unexpected tag target: ${name}`,
        path: name,
      });
    }

    const tagObject = await this.request<GitHubAnnotatedTagResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/tags/${tagRef.object.sha}`,
      name,
    );

    if (tagObject.object.type !== "commit") {
      throw new GitHubFsError({
        code: "ENOTSUP",
        isRetryable: false,
        kind: "unsupported",
        message: "gitinspect v0 does not support annotated tags that target trees or blobs.",
        path: name,
      });
    }

    return tagObject.object.sha;
  }
}

function normalizePath(path: string): string {
  const trimmed = path.trim();

  if (!trimmed || trimmed === "/" || trimmed === ".") {
    return "";
  }

  const normalizedSegments: string[] = [];

  for (const segment of trimmed.split("/")) {
    const next = segment.trim();

    if (!next || next === ".") {
      continue;
    }

    if (next === "..") {
      normalizedSegments.pop();
      continue;
    }

    normalizedSegments.push(next);
  }

  return normalizedSegments.join("/");
}
