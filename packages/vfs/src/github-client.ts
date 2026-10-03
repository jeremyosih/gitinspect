import { Effect, Exit, Cause, Semaphore } from "effect";
import {
  GitHubFsError,
  type GitHubBlobResponse,
  type GitHubContentResponse,
  type GitHubTreeResponse,
} from "./types.js";
import { displayResolvedRef, type GitHubResolvedRef } from "./refs.js";
import {
  getGitHubRateLimitResponseDetails,
  parseGitHubRateLimitInfo,
} from "./github-rate-limit.js";
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
  getToken?: () => Promise<string | undefined>;
  baseUrl: string;
  signal?: AbortSignal;
  maxConcurrency?: number;
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
  private readonly getToken?: () => Promise<string | undefined>;
  private readonly baseUrl: string;
  private resolvedCommitPromise?: Promise<GitHubCommitResponse>;
  private resolvedCommit?: GitHubCommitResponse;
  private resolvedCommitSignal?: AbortSignal;
  private readonly permits: Semaphore.Semaphore;
  private readonly defaultSignal?: AbortSignal;
  rateLimit: RateLimitInfo | null = null;

  constructor(options: GitHubClientOptions) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.ref = options.ref;
    this.token = options.token;
    this.getToken = options.getToken;
    this.baseUrl = options.baseUrl;
    this.permits = Semaphore.makeUnsafe(options.maxConcurrency ?? 6);
    this.defaultSignal = options.signal;
  }

  async fetchContents(path: string): Promise<GitHubContentResponse | GitHubContentResponse[]> {
    const normalized = normalizePath(path);
    const commit = await this.fetchResolvedCommit();
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/contents/${normalized}?ref=${encodeURIComponent(commit.sha)}`;
    return this.request<GitHubContentResponse | GitHubContentResponse[]>(url, path);
  }

  async fetchTree(
    sha?: string,
    recursive = true,
    signal?: AbortSignal,
  ): Promise<GitHubTreeResponse> {
    const treeSha = sha ?? (await this.fetchResolvedCommit(signal)).commit.tree.sha;

    return this.request<GitHubTreeResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/trees/${treeSha}${recursive ? "?recursive=1" : ""}`,
      "/",
      signal,
    );
  }

  async fetchBlob(sha: string, signal?: AbortSignal): Promise<GitHubBlobResponse> {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/blobs/${sha}`;
    return this.request<GitHubBlobResponse>(url, sha, signal);
  }

  async fetchResolvedCommit(signal = this.defaultSignal): Promise<GitHubCommitResponse> {
    signal?.throwIfAborted();
    if (this.resolvedCommit) return this.resolvedCommit;
    if (this.resolvedCommitSignal?.aborted) this.resolvedCommitPromise = undefined;
    if (!this.resolvedCommitPromise) {
      this.resolvedCommitSignal = signal;
      const promise = this.loadResolvedCommit(signal)
        .then((commit) => {
          signal?.throwIfAborted();
          return (this.resolvedCommit ??= commit);
        })
        .catch((error: unknown) => {
          if (this.resolvedCommitPromise === promise) this.resolvedCommitPromise = undefined;
          throw error;
        });
      this.resolvedCommitPromise = promise;
    }

    return await this.resolvedCommitPromise;
  }

  private async loadResolvedCommit(signal?: AbortSignal): Promise<GitHubCommitResponse> {
    if (this.ref.kind === "commit") {
      return await this.request<GitHubCommitResponse>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(this.ref.sha)}`,
        this.ref.sha,
        signal,
      );
    }

    const commitSha =
      this.ref.kind === "branch"
        ? await this.fetchRefCommitSha("heads", this.ref.name, signal)
        : await this.fetchTagCommitSha(this.ref.name, undefined, signal);

    return await this.request<GitHubCommitResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/commits/${encodeURIComponent(commitSha)}`,
      displayResolvedRef(this.ref),
      signal,
    );
  }

  private async request<T>(
    url: string,
    pathForError: string,
    signal = this.defaultSignal,
  ): Promise<T> {
    const effect = Effect.tryPromise({
      try: async (signal) => this.requestInternal<T>(url, pathForError, signal),
      catch: (error) =>
        error instanceof GitHubFsError
          ? error
          : new GitHubFsError({
              code: "EIO",
              kind: "network",
              message: `GitHub request failed: ${pathForError}`,
              path: pathForError,
              cause: error,
              isRetryable: true,
            }),
    }).pipe(this.permits.withPermit, Effect.timeout("60 seconds"));
    const exit = await Effect.runPromiseExit(effect, { signal });
    if (Exit.isSuccess(exit)) return exit.value;
    if (signal?.aborted) throw new DOMException("Repository read cancelled", "AbortError");
    throw Cause.squash(exit.cause);
  }

  private async requestInternal<T>(
    url: string,
    pathForError: string,
    signal: AbortSignal,
  ): Promise<T> {
    const token = await this.resolveToken();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await this.fetchWithOptionalAnonymousFallback(
      url,
      headers,
      pathForError,
      token,
      signal,
    );

    if (!response.ok) {
      throw await this.httpError(response, pathForError);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new GitHubFsError("EIO", "Empty GitHub response", pathForError);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 32 * 1024 * 1024) {
          await reader.cancel();
          throw new GitHubFsError("EFBIG", "GitHub response exceeds 32 MiB", pathForError);
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  }

  private async resolveToken(): Promise<string | undefined> {
    const token = await this.getToken?.();
    return token ?? this.token;
  }

  private async fetchWithOptionalAnonymousFallback(
    url: string,
    headers: Record<string, string>,
    pathForError: string,
    token: string | undefined,
    signal: AbortSignal,
  ): Promise<Response> {
    let response: Response;

    try {
      response = await fetch(url, { headers, signal });
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

    this.observeRateLimit(response);
    const rateLimitDetails = await getGitHubRateLimitResponseDetails(response);
    if (rateLimitDetails) {
      throw this.createRateLimitError(
        pathForError,
        rateLimitDetails.retryAtMs,
        rateLimitDetails.kind,
      );
    }

    if (response.ok || !token) {
      return response;
    }

    const detail = await readGitHubErrorMessage(response);
    if (!shouldRetryUnauthenticated(response, detail)) {
      return response;
    }

    const fallbackResponse = await fetch(url, {
      headers: stripAuthorization(headers),
      signal,
    });

    this.observeRateLimit(fallbackResponse);
    const fallbackRateLimitDetails = await getGitHubRateLimitResponseDetails(fallbackResponse);
    if (fallbackRateLimitDetails) {
      throw this.createRateLimitError(
        pathForError,
        fallbackRateLimitDetails.retryAtMs,
        fallbackRateLimitDetails.kind,
      );
    }

    return fallbackResponse.ok ? fallbackResponse : response;
  }

  private observeRateLimit(res: Response): void {
    const info = parseGitHubRateLimitInfo(res);
    if (info) {
      this.rateLimit = info;
    }
  }

  private createRateLimitError(
    path: string,
    retryAt: number | undefined,
    rateLimitKind: "primary" | "secondary" | "unknown",
  ): GitHubFsError {
    return new GitHubFsError({
      code: "EACCES",
      isRetryable: true,
      kind: "rate_limit",
      message: `GitHub API rate limit exceeded${retryAt ? ` (retry after ${new Date(retryAt).toLocaleTimeString()})` : ""}: ${path}`,
      path,
      rateLimitKind,
      retryAt,
      status: 429,
    });
  }

  private async httpError(res: Response, path: string): Promise<GitHubFsError> {
    return toGitHubFsError(res, path, await readGitHubErrorMessage(res));
  }

  private async fetchRefCommitSha(
    namespace: GitHubRefNamespace,
    name: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const refData = await this.request<GitHubRefResponse>(
      `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/ref/${namespace}/${encodeURIComponent(name)}`,
      name,
      signal,
    );

    if (refData.object.type === "commit") {
      return refData.object.sha;
    }

    if (namespace === "tags" && refData.object.type === "tag") {
      return await this.fetchTagCommitSha(name, refData, signal);
    }

    throw new GitHubFsError({
      code: "EIO",
      isRetryable: false,
      kind: "unknown",
      message: `GitHub API returned an unexpected ${namespace.slice(0, -1)} target: ${name}`,
      path: name,
    });
  }

  private async fetchTagCommitSha(
    name: string,
    refData?: GitHubRefResponse,
    signal?: AbortSignal,
  ): Promise<string> {
    const tagRef =
      refData ??
      (await this.request<GitHubRefResponse>(
        `${this.baseUrl}/repos/${this.owner}/${this.repo}/git/ref/tags/${encodeURIComponent(name)}`,
        name,
        signal,
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
      signal,
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
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  return segments.map(encodeURIComponent).join("/");
}
