import type { GitHubTreeEntry } from "./types.js";

const utf8Encoder = new TextEncoder();

function getContentSize(data: string | Uint8Array): number {
  return typeof data === "string" ? utf8Encoder.encode(data).byteLength : data.byteLength;
}

export interface TreeCacheOptions {
  ttlMs: number;
}

export interface ContentCacheOptions {
  maxBytes: number;
  maxEntries: number;
}

export class TreeCache {
  private entries: Map<string, GitHubTreeEntry> = new Map();
  private loadedAt: number = 0;
  private treeSha: string | null = null;
  private readonly ttlMs: number;

  constructor(options: TreeCacheOptions) {
    this.ttlMs = options.ttlMs;
  }

  get loaded(): boolean {
    return this.treeSha !== null && !this.isExpired();
  }

  load(sha: string, entries: GitHubTreeEntry[]): void {
    this.entries.clear();
    for (const entry of entries) {
      this.entries.set(entry.path, entry);
    }
    this.treeSha = sha;
    this.loadedAt = Date.now();
  }

  get(path: string): GitHubTreeEntry | undefined {
    if (this.isExpired()) return undefined;
    return this.entries.get(path);
  }

  listDir(dirPath: string): GitHubTreeEntry[] {
    if (this.isExpired()) return [];
    const prefix = dirPath === "" ? "" : dirPath + "/";
    const results: GitHubTreeEntry[] = [];

    for (const [entryPath, entry] of this.entries) {
      if (prefix === "") {
        // Root: entries with no "/" in their path
        if (!entryPath.includes("/")) {
          results.push(entry);
        }
      } else if (entryPath.startsWith(prefix)) {
        const rest = entryPath.slice(prefix.length);
        if (!rest.includes("/")) {
          results.push(entry);
        }
      }
    }
    return results;
  }

  allPaths(): string[] {
    if (this.isExpired()) return [];
    return Array.from(this.entries.keys());
  }

  clear(): void {
    this.entries.clear();
    this.treeSha = null;
    this.loadedAt = 0;
  }

  private isExpired(): boolean {
    if (this.treeSha === null) return true;
    return Date.now() - this.loadedAt > this.ttlMs;
  }
}

interface ContentEntry {
  data: string | Uint8Array;
  size: number;
}

export class ContentCache {
  private cache: Map<string, ContentEntry> = new Map();
  private totalBytes: number = 0;
  private readonly maxBytes: number;
  private readonly maxEntries: number;

  constructor(options: ContentCacheOptions) {
    this.maxBytes = options.maxBytes;
    this.maxEntries = options.maxEntries;
  }

  get(sha: string): (string | Uint8Array) | undefined {
    const entry = this.cache.get(sha);
    if (!entry) return undefined;
    // Move to end for LRU
    this.cache.delete(sha);
    this.cache.set(sha, entry);
    return entry.data;
  }

  set(sha: string, data: string | Uint8Array): void {
    const size = getContentSize(data);

    // Remove existing entry if present
    const existing = this.cache.get(sha);
    if (existing) {
      this.totalBytes -= existing.size;
      this.cache.delete(sha);
    }

    // Evict until we have room
    while (
      (this.totalBytes + size > this.maxBytes || this.cache.size >= this.maxEntries) &&
      this.cache.size > 0
    ) {
      const oldest = this.cache.keys().next().value!;
      const entry = this.cache.get(oldest)!;
      this.totalBytes -= entry.size;
      this.cache.delete(oldest);
    }

    this.cache.set(sha, { data, size });
    this.totalBytes += size;
  }

  has(sha: string): boolean {
    return this.cache.has(sha);
  }

  clear(): void {
    this.cache.clear();
    this.totalBytes = 0;
  }
}
