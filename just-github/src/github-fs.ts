import type { IFileSystem } from "just-bash";
import { ContentCache, TreeCache } from "./cache.js";
import { GitHubClient } from "./github-client.js";
import {
  GitHubFsError,
  type TreeLoadWarning,
  type DirEntry,
  type GitHubContentResponse,
  type GitHubFsOptions,
} from "./types.js";

const DEFAULT_TREE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CONTENT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_CONTENT_MAX_ENTRIES = 1000;

export class GitHubFs implements IFileSystem {
  private readonly client: GitHubClient;
  private readonly treeCache: TreeCache;
  private readonly contentCache: ContentCache;
  private readonly cachingEnabled: boolean;
  private readonly warningsInternal: TreeLoadWarning[] = [];

  constructor(options: GitHubFsOptions) {
    this.client = new GitHubClient({
      owner: options.owner,
      repo: options.repo,
      ref: options.ref ?? "main",
      token: options.token,
      baseUrl: options.baseUrl ?? "https://api.github.com",
    });

    this.cachingEnabled = options.cache?.enabled !== false;

    this.treeCache = new TreeCache({
      ttlMs: options.cache?.treeTtlMs ?? DEFAULT_TREE_TTL_MS,
    });

    this.contentCache = new ContentCache({
      maxBytes: options.cache?.contentMaxBytes ?? DEFAULT_CONTENT_MAX_BYTES,
      maxEntries: options.cache?.contentMaxEntries ?? DEFAULT_CONTENT_MAX_ENTRIES,
    });
  }

  // --- Read operations ---

  async readFile(path: string): Promise<string> {
    const normalized = normalizePath(path);

    // Check content cache via tree (SHA-keyed)
    if (this.cachingEnabled && this.treeCache.loaded) {
      const entry = this.treeCache.get(normalized);
      if (entry && entry.type === "blob") {
        const cached = this.contentCache.get(entry.sha);
        if (typeof cached === "string") return cached;
      }
    }

    try {
      const response = await this.client.fetchContents(normalized);
      if (Array.isArray(response)) {
        throw new GitHubFsError("EISDIR", `Is a directory: ${path}`, path);
      }
      if (response.type !== "file" && response.type !== "symlink") {
        throw new GitHubFsError("EISDIR", `Is a directory: ${path}`, path);
      }

      let content: string;
      if (response.content && response.encoding === "base64") {
        content = decodeBase64(response.content);
      } else {
        content = await this.client.fetchRaw(normalized);
      }

      if (this.cachingEnabled) {
        this.contentCache.set(response.sha, content);
      }
      return content;
    } catch (err) {
      if (err instanceof GitHubFsError) throw err;
      throw new GitHubFsError("EIO", `Failed to read file: ${path}`, path);
    }
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const normalized = normalizePath(path);

    if (this.cachingEnabled && this.treeCache.loaded) {
      const entry = this.treeCache.get(normalized);
      if (entry && entry.type === "blob") {
        const cached = this.contentCache.get(entry.sha);
        if (cached instanceof Uint8Array) return cached;
      }
    }

    try {
      const buffer = await this.client.fetchRawBuffer(normalized);
      if (this.cachingEnabled && this.treeCache.loaded) {
        const entry = this.treeCache.get(normalized);
        if (entry) {
          this.contentCache.set(entry.sha, buffer);
        }
      }
      return buffer;
    } catch (err) {
      if (err instanceof GitHubFsError) throw err;
      throw new GitHubFsError("EIO", `Failed to read file: ${path}`, path);
    }
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await this.readdirInternal(path);
    return entries.map((e) => e.name);
  }

  async readdirWithFileTypes(path: string): Promise<{ name: string; isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean }[]> {
    const entries = await this.readdirInternal(path);
    return entries.map((e) => ({
      name: e.name,
      isFile: e.type === "file",
      isDirectory: e.type === "dir" || e.type === "submodule",
      isSymbolicLink: e.type === "symlink",
    }));
  }

  async stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean; mode: number; size: number; mtime: Date }> {
    const info = await this.statInternal(path);
    return toFsStat(info.type, info.size, info.mode);
  }

  async lstat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; isSymbolicLink: boolean; mode: number; size: number; mtime: Date }> {
    // Same as stat — GitHub doesn't distinguish
    return this.stat(path);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.stat(path);
      return true;
    } catch (err) {
      if (err instanceof GitHubFsError && err.code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  async realpath(path: string): Promise<string> {
    const normalized = normalizePath(path);
    return "/" + normalized;
  }

  async readlink(path: string): Promise<string> {
    const content = await this.readFile(path);
    return content.trim();
  }

  // --- Directory listing (internal) ---

  private async readdirInternal(path: string): Promise<DirEntry[]> {
    const normalized = normalizePath(path);

    if (this.cachingEnabled && this.treeCache.loaded) {
      // For root, check if tree has any entries at all
      if (normalized === "") {
        const entries = this.treeCache.listDir("");
        return entries.map((e) => ({
          name: e.path.split("/").pop()!,
          type: treeEntryType(e.type, e.mode),
          size: e.size ?? 0,
          sha: e.sha,
        }));
      }
      const treeEntry = this.treeCache.get(normalized);
      if (treeEntry?.type === "tree") {
        const entries = this.treeCache.listDir(normalized);
        return entries.map((e) => ({
          name: e.path.split("/").pop()!,
          type: treeEntryType(e.type, e.mode),
          size: e.size ?? 0,
          sha: e.sha,
        }));
      }
    }

    const response = await this.client.fetchContents(normalized);
    if (!Array.isArray(response)) {
      throw new GitHubFsError("ENOTDIR", `Not a directory: ${path}`, path);
    }

    return response.map((entry: GitHubContentResponse) => ({
      name: entry.name,
      type: entry.type as DirEntry["type"],
      size: entry.size,
      sha: entry.sha,
    }));
  }

  private async statInternal(path: string): Promise<{ type: string; size: number; sha: string; mode: string }> {
    const normalized = normalizePath(path);

    if (normalized === "") {
      return { type: "dir", size: 0, sha: "", mode: "040000" };
    }

    // Eagerly load tree on first stat — just-bash stat's PATH entries
    // for every command, so we want the tree cached to avoid burning API calls
    await this.loadTree();

    if (this.treeCache.loaded) {
      const entry = this.treeCache.get(normalized);
      if (entry) {
        return {
          type: treeEntryType(entry.type, entry.mode),
          size: entry.size ?? 0,
          sha: entry.sha,
          mode: entry.mode,
        };
      }
      throw new GitHubFsError("ENOENT", `No such file or directory: ${path}`, path);
    }

    const response = await this.client.fetchContents(normalized);
    if (Array.isArray(response)) {
      return { type: "dir", size: 0, sha: "", mode: "040000" };
    }
    return {
      type: response.type,
      size: response.size,
      sha: response.sha,
      mode: response.type === "file" ? "100644" : "040000",
    };
  }

  // --- Tree ---

  async tree(): Promise<string[]> {
    await this.loadTree();
    return this.treeCache.allPaths();
  }

  getAllPaths(): string[] {
    return this.treeCache.allPaths();
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith("/")) return path;
    const parts = base.split("/").filter(Boolean);
    for (const segment of path.split("/")) {
      if (segment === "..") parts.pop();
      else if (segment !== ".") parts.push(segment);
    }
    return "/" + parts.join("/");
  }

  // --- Write operations (read-only — all throw EROFS) ---

  async writeFile(): Promise<void> {
    throw new GitHubFsError("EROFS", "Read-only filesystem");
  }

  async appendFile(): Promise<void> {
    throw new GitHubFsError("EROFS", "Read-only filesystem");
  }

  async mkdir(): Promise<void> {
    throw new GitHubFsError("EROFS", "Read-only filesystem");
  }

  async rm(): Promise<void> {
    throw new GitHubFsError("EROFS", "Read-only filesystem");
  }

  async cp(): Promise<void> {
    throw new GitHubFsError("EROFS", "Read-only filesystem");
  }

  async mv(): Promise<void> {
    throw new GitHubFsError("EROFS", "Read-only filesystem");
  }

  async chmod(): Promise<void> {
    throw new GitHubFsError("EROFS", "Read-only filesystem");
  }

  async symlink(): Promise<void> {
    throw new GitHubFsError("EROFS", "Read-only filesystem");
  }

  async link(): Promise<void> {
    throw new GitHubFsError("EROFS", "Read-only filesystem");
  }

  async utimes(): Promise<void> {
    // no-op — git doesn't track timestamps
  }

  // --- Utilities ---

  refresh(): void {
    this.treeCache.clear();
    this.contentCache.clear();
    this.warningsInternal.length = 0;
  }

  get rateLimit() {
    return this.client.rateLimit;
  }

  get warnings(): TreeLoadWarning[] {
    return [...this.warningsInternal];
  }

  private async loadTree(): Promise<void> {
    if (this.treeCache.loaded) return;
    const response = await this.client.fetchTree();
    this.warningsInternal.length = 0;
    if (response.truncated) {
      this.warningsInternal.push({
        message:
          "GitHub returned a truncated repository tree. Some files may be unavailable to bash and directory traversal.",
        type: "truncated-tree",
      });
    }
    this.treeCache.load(response.sha, response.tree);
  }
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function treeEntryType(type: string, mode: string): DirEntry["type"] {
  if (type === "commit") return "submodule";
  if (mode === "120000") return "symlink";
  if (type === "tree") return "dir";
  return "file";
}

function toFsStat(type: string, size: number, mode: string) {
  const modeNum = parseInt(mode, 8) || 0o100644;
  return {
    isFile: type === "file",
    isDirectory: type === "dir" || type === "submodule",
    isSymbolicLink: type === "symlink",
    mode: modeNum,
    size,
    mtime: new Date(0),
  };
}

function decodeBase64(encoded: string): string {
  const cleaned = encoded.replace(/\n/g, "");
  const bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
