import type { IFileSystem } from "just-bash";
import { Effect } from "effect";
import { ContentCache } from "./cache.js";
import { GitHubClient } from "./github-client.js";
import {
  GitHubFsError,
  type GitHubFsOptions,
  type GitHubTreeEntry,
  type TreeLoadWarning,
} from "./types.js";

export function normalizeRepoPath(path: string): string {
  if (path.includes("\0")) throw new GitHubFsError("EINVAL", "Path contains NUL", path);
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
function fsError(code: string, path: string): GitHubFsError {
  return new GitHubFsError(
    code,
    `${code === "ENOENT" ? "No such file or directory" : code}: ${path}`,
    path,
  );
}
type Flight = {
  controller: AbortController;
  promise: Promise<unknown>;
  waiters: number;
  settled: boolean;
};

/** One immutable Git commit. Branch changes are observed by opening a new snapshot. */
export class GitHubFs implements IFileSystem {
  private client: GitHubClient;
  private entries = new Map<string, GitHubTreeEntry>();
  private children = new Map<string, GitHubTreeEntry[]>();
  private completeDirs = new Set<string>();
  private flights = new Map<string, Flight>();
  private blobs: ContentCache;
  private initialized = false;
  private rootSha = "";
  private commitSha?: string;
  private lastError?: GitHubFsError;
  private readonly maxFileBytes: number;
  private readonly caching: boolean;
  private readonly warningRows: TreeLoadWarning[] = [];
  constructor(options: GitHubFsOptions) {
    this.client = new GitHubClient({
      ...options,
      baseUrl: options.baseUrl ?? "https://api.github.com",
    });
    this.blobs = new ContentCache({
      maxBytes: options.cache?.contentMaxBytes ?? 50 * 1024 * 1024,
      maxEntries: options.cache?.contentMaxEntries ?? 1000,
    });
    this.maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
    this.caching = options.cache?.enabled !== false;
  }
  // Effect is the execution boundary; Promise methods below adapt it for just-bash.
  readBytesEffect(path: string): Effect.Effect<Uint8Array, GitHubFsError | Error> {
    return Effect.tryPromise({
      try: (signal) => this.readFileBuffer(path, signal),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    });
  }
  async snapshotCommit(signal?: AbortSignal): Promise<string> {
    await this.init(signal);
    return this.commitSha!;
  }
  private async single<T>(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    let flight = this.flights.get(key);
    if (!flight) {
      const controller = new AbortController();
      flight = { controller, promise: Promise.resolve(), waiters: 0, settled: false };
      const current = flight;
      current.promise = Promise.resolve()
        .then(() => load(controller.signal))
        .finally(() => {
          current.settled = true;
          if (this.flights.get(key) === current) this.flights.delete(key);
        });
      this.flights.set(key, current);
    }
    flight.waiters++;
    const current = flight;
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([
        current.promise as Promise<T>,
        new Promise<never>((_, reject) => {
          onAbort = () =>
            reject(signal?.reason ?? new DOMException("Repository read cancelled", "AbortError"));
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) onAbort();
        }),
      ]);
    } catch (error) {
      if (error instanceof GitHubFsError) this.lastError = error;
      throw error;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      current.waiters--;
      if (!current.settled && current.waiters === 0) {
        if (this.flights.get(key) === current) this.flights.delete(key);
        current.controller.abort();
      }
    }
  }
  private async init(signal?: AbortSignal): Promise<void> {
    if (this.initialized) return;
    await this.single(
      "root",
      async (signal) => {
        const commit = await this.client.fetchResolvedCommit(signal);
        this.commitSha = commit.sha;
        this.rootSha = commit.commit.tree.sha;
        const tree = await this.client.fetchTree(undefined, true, signal);
        if (tree.truncated) {
          // Never infer absence from an incomplete recursive result.
          const root = await this.client.fetchTree(this.rootSha, false, signal);
          signal.throwIfAborted();
          if (root.truncated) throw fsError("EIO", "GitHub truncated a non-recursive tree");
          this.index("", root.tree);
          this.completeDirs.add("");
        } else {
          signal.throwIfAborted();
          this.index("", tree.tree);
          this.completeDirs.add("");
          for (const entry of tree.tree)
            if (entry.type === "tree") this.completeDirs.add(entry.path);
        }
        this.initialized = true;
      },
      signal,
    );
  }
  private index(parent: string, entries: GitHubTreeEntry[]): void {
    for (const raw of entries) {
      const entry = { ...raw, path: parent ? `${parent}/${raw.path}` : raw.path };
      this.entries.set(entry.path, entry);
      const dir = entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "";
      const siblings = this.children.get(dir) ?? [];
      if (!siblings.some((other) => other.path === entry.path)) siblings.push(entry);
      this.children.set(dir, siblings);
    }
  }
  private async loadDir(path: string, signal?: AbortSignal): Promise<void> {
    if (this.completeDirs.has(path)) return;
    const entry = this.entries.get(path);
    if (!entry) throw fsError("ENOENT", path);
    if (entry.type !== "tree") throw fsError(entry.type === "commit" ? "ENOTSUP" : "ENOTDIR", path);
    await this.single(
      `tree:${entry.sha}:${path}`,
      async (signal) => {
        // A per-request client shares the pinned commit, never a mutable branch.
        const tree = await this.client.fetchTree(entry.sha, false, signal);
        if (tree.truncated) throw fsError("EIO", path);
        this.index(path, tree.tree);
        this.completeDirs.add(path);
      },
      signal,
    );
  }
  private async lookup(
    path: string,
    follow = true,
    signal?: AbortSignal,
    depth = 0,
  ): Promise<GitHubTreeEntry> {
    if (depth > 40) throw fsError("ELOOP", path);
    await this.init(signal);
    const normalized = normalizeRepoPath(path);
    if (!normalized) return { path: "", sha: this.rootSha, type: "tree", mode: "040000" };
    const parts = normalized.split("/");
    let parent = "";
    for (let i = 0; i < parts.length; i++) {
      await this.loadDir(parent, signal);
      const current = parent ? `${parent}/${parts[i]}` : parts[i]!;
      const entry = this.entries.get(current);
      if (!entry) throw fsError("ENOENT", path);
      if (entry.mode === "120000" && (follow || i < parts.length - 1)) {
        const target = new TextDecoder().decode(await this.blob(entry, signal));
        const resolved = target.startsWith("/") ? target : `${parent}/${target}`;
        return this.lookup([resolved, ...parts.slice(i + 1)].join("/"), follow, signal, depth + 1);
      }
      if (i === parts.length - 1) return entry;
      if (entry.type !== "tree")
        throw fsError(entry.type === "commit" ? "ENOTSUP" : "ENOTDIR", current);
      parent = current;
    }
    throw fsError("ENOENT", path);
  }
  private async blob(entry: GitHubTreeEntry, signal?: AbortSignal): Promise<Uint8Array> {
    if ((entry.size ?? 0) > this.maxFileBytes) throw fsError("EFBIG", entry.path);
    const cached = this.blobs.get(entry.sha);
    if (cached instanceof Uint8Array) return cached;
    return this.single(
      `blob:${entry.sha}`,
      async (signal) => {
        const blob = await this.client.fetchBlob(entry.sha, signal);
        if (blob.size > this.maxFileBytes) throw fsError("EFBIG", entry.path);
        const bytes =
          blob.encoding === "base64"
            ? Uint8Array.from(atob(blob.content.replace(/\s/g, "")), (c) => c.charCodeAt(0))
            : new TextEncoder().encode(blob.content);
        if (bytes.byteLength > this.maxFileBytes) throw fsError("EFBIG", entry.path);
        if (this.caching) this.blobs.set(entry.sha, bytes);
        return bytes;
      },
      signal,
    );
  }
  async readFile(
    path: string,
    options?: Parameters<IFileSystem["readFile"]>[1] | AbortSignal,
  ): Promise<string> {
    const signal = options instanceof AbortSignal ? options : undefined;
    return new TextDecoder().decode(await this.readFileBuffer(path, signal));
  }
  async readFileBuffer(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    const entry = await this.lookup(path, true, signal);
    if (entry.type !== "blob") throw fsError(entry.type === "commit" ? "ENOTSUP" : "EISDIR", path);
    return (await this.blob(entry, signal)).slice();
  }
  async readdirWithFileTypes(path: string, signal?: AbortSignal) {
    const dir = await this.lookup(path, true, signal);
    if (dir.type !== "tree") throw fsError(dir.type === "commit" ? "ENOTSUP" : "ENOTDIR", path);
    await this.loadDir(dir.path, signal);
    return [...(this.children.get(dir.path) ?? [])]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((entry) => ({
        name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
        isFile: entry.type === "blob" && entry.mode !== "120000",
        isDirectory: entry.type === "tree",
        isSymbolicLink: entry.mode === "120000",
      }));
  }
  async readdir(path: string, signal?: AbortSignal): Promise<string[]> {
    return (await this.readdirWithFileTypes(path, signal)).map((entry) => entry.name);
  }
  private async info(path: string, follow: boolean, signal?: AbortSignal) {
    const entry = await this.lookup(path, follow, signal);
    return {
      isFile: entry.type === "blob" && entry.mode !== "120000",
      isDirectory: entry.type === "tree",
      isSymbolicLink: entry.mode === "120000",
      mode: parseInt(entry.mode, 8),
      size: entry.size ?? 0,
      mtime: new Date(0),
    };
  }
  stat(path: string, signal?: AbortSignal) {
    return this.info(path, true, signal);
  }
  lstat(path: string, signal?: AbortSignal) {
    return this.info(path, false, signal);
  }
  async exists(path: string, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.stat(path, signal);
      return true;
    } catch (error) {
      if (error instanceof GitHubFsError && error.code === "ENOENT") return false;
      throw error;
    }
  }
  async realpath(path: string, signal?: AbortSignal): Promise<string> {
    return "/" + (await this.lookup(path, true, signal)).path;
  }
  async readlink(path: string, signal?: AbortSignal): Promise<string> {
    const entry = await this.lookup(path, false, signal);
    if (entry.mode !== "120000") throw fsError("EINVAL", path);
    return new TextDecoder().decode(await this.blob(entry, signal));
  }
  resolvePath(base: string, path: string): string {
    return "/" + normalizeRepoPath(path.startsWith("/") ? path : `${base}/${path}`);
  }
  getAllPaths(): string[] {
    return [...this.entries.keys()].sort();
  }
  async tree(signal?: AbortSignal): Promise<string[]> {
    await this.init(signal);
    for (const entry of this.entries.values())
      if (entry.type === "tree") await this.loadDir(entry.path, signal);
    return this.getAllPaths();
  }
  withSignal(signal?: AbortSignal): IFileSystem {
    return new Proxy(this, {
      get: (target, key) => {
        const value = Reflect.get(target, key);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (
            [
              "readFile",
              "readFileBuffer",
              "stat",
              "lstat",
              "exists",
              "realpath",
              "readlink",
              "readdir",
              "readdirWithFileTypes",
            ].includes(String(key))
          )
            return value.call(target, args[0], signal);
          return value.apply(target, args);
        };
      },
    });
  }
  refresh(): void {
    if (this.flights.size) throw fsError("EBUSY", "Repository has pending reads");
    this.entries.clear();
    this.children.clear();
    this.completeDirs.clear();
    this.blobs.clear();
    this.initialized = false;
    this.warningRows.length = 0;
    this.lastError = undefined;
  }
  get warnings(): TreeLoadWarning[] {
    return [...this.warningRows];
  }
  get rateLimit() {
    return this.client.rateLimit;
  }
  clearLastError(): void {
    this.lastError = undefined;
  }
  consumeLastError(): GitHubFsError | undefined {
    const error = this.lastError;
    this.lastError = undefined;
    return error;
  }
  async writeFile(): Promise<void> {
    throw fsError("EROFS", "Read-only repository");
  }
  appendFile = this.writeFile;
  mkdir = this.writeFile;
  rm = this.writeFile;
  cp = this.writeFile;
  mv = this.writeFile;
  chmod = this.writeFile;
  symlink = this.writeFile;
  link = this.writeFile;
  utimes = this.writeFile;
}
