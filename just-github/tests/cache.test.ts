import { describe, it, expect, beforeEach } from "vitest";
import { TreeCache, ContentCache } from "../src/cache.js";

describe("TreeCache", () => {
  let cache: TreeCache;

  beforeEach(() => {
    cache = new TreeCache({ ttlMs: 60_000 });
  });

  it("starts unloaded", () => {
    expect(cache.loaded).toBe(false);
    expect(cache.allPaths()).toEqual([]);
  });

  it("loads tree entries", () => {
    cache.load("abc123", [
      { path: "src", mode: "040000", type: "tree", sha: "aaa" },
      { path: "src/index.ts", mode: "100644", type: "blob", sha: "bbb", size: 100 },
      { path: "README.md", mode: "100644", type: "blob", sha: "ccc", size: 50 },
    ]);

    expect(cache.loaded).toBe(true);
    expect(cache.allPaths()).toEqual(["src", "src/index.ts", "README.md"]);
  });

  it("gets individual entries", () => {
    cache.load("abc123", [
      { path: "src/index.ts", mode: "100644", type: "blob", sha: "bbb", size: 100 },
    ]);

    const entry = cache.get("src/index.ts");
    expect(entry).toBeDefined();
    expect(entry!.sha).toBe("bbb");
    expect(entry!.size).toBe(100);
  });

  it("returns undefined for missing entries", () => {
    cache.load("abc123", []);
    expect(cache.get("nope")).toBeUndefined();
  });

  it("lists root directory entries", () => {
    cache.load("abc123", [
      { path: "src", mode: "040000", type: "tree", sha: "aaa" },
      { path: "src/index.ts", mode: "100644", type: "blob", sha: "bbb", size: 100 },
      { path: "README.md", mode: "100644", type: "blob", sha: "ccc", size: 50 },
    ]);

    const rootEntries = cache.listDir("");
    expect(rootEntries.map((e) => e.path)).toEqual(["src", "README.md"]);
  });

  it("lists subdirectory entries", () => {
    cache.load("abc123", [
      { path: "src", mode: "040000", type: "tree", sha: "aaa" },
      { path: "src/index.ts", mode: "100644", type: "blob", sha: "bbb", size: 100 },
      { path: "src/utils", mode: "040000", type: "tree", sha: "ddd" },
      { path: "src/utils/helper.ts", mode: "100644", type: "blob", sha: "eee", size: 30 },
    ]);

    const srcEntries = cache.listDir("src");
    expect(srcEntries.map((e) => e.path)).toEqual(["src/index.ts", "src/utils"]);
  });

  it("expires after TTL", () => {
    const shortCache = new TreeCache({ ttlMs: 1 });
    shortCache.load("abc123", [
      { path: "file.txt", mode: "100644", type: "blob", sha: "aaa", size: 10 },
    ]);

    // Force expiration with a synchronous wait approach
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }

    expect(shortCache.loaded).toBe(false);
    expect(shortCache.get("file.txt")).toBeUndefined();
  });

  it("clears all entries", () => {
    cache.load("abc123", [
      { path: "file.txt", mode: "100644", type: "blob", sha: "aaa", size: 10 },
    ]);
    cache.clear();
    expect(cache.loaded).toBe(false);
    expect(cache.allPaths()).toEqual([]);
  });
});

describe("ContentCache", () => {
  let cache: ContentCache;

  beforeEach(() => {
    cache = new ContentCache({ maxBytes: 1024, maxEntries: 10 });
  });

  it("stores and retrieves string content", () => {
    cache.set("sha1", "hello world");
    expect(cache.get("sha1")).toBe("hello world");
  });

  it("stores and retrieves buffer content", () => {
    const data = new Uint8Array([1, 2, 3]);
    cache.set("sha2", data);
    expect(cache.get("sha2")).toEqual(data);
  });

  it("returns undefined for missing entries", () => {
    expect(cache.get("nope")).toBeUndefined();
  });

  it("reports has correctly", () => {
    cache.set("sha1", "data");
    expect(cache.has("sha1")).toBe(true);
    expect(cache.has("sha2")).toBe(false);
  });

  it("evicts oldest entries when maxEntries exceeded", () => {
    const small = new ContentCache({ maxBytes: 1_000_000, maxEntries: 3 });
    small.set("a", "1");
    small.set("b", "2");
    small.set("c", "3");
    small.set("d", "4"); // should evict "a"

    expect(small.has("a")).toBe(false);
    expect(small.has("b")).toBe(true);
    expect(small.has("d")).toBe(true);
  });

  it("evicts oldest entries when maxBytes exceeded", () => {
    const tiny = new ContentCache({ maxBytes: 10, maxEntries: 100 });
    tiny.set("a", "12345"); // 5 bytes
    tiny.set("b", "12345"); // 5 bytes — total 10
    tiny.set("c", "12345"); // 5 bytes — should evict "a"

    expect(tiny.has("a")).toBe(false);
    expect(tiny.has("b")).toBe(true);
    expect(tiny.has("c")).toBe(true);
  });

  it("clears all entries", () => {
    cache.set("a", "data");
    cache.set("b", "data");
    cache.clear();
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(false);
  });

  it("updates existing entries in place", () => {
    cache.set("sha1", "old");
    cache.set("sha1", "new");
    expect(cache.get("sha1")).toBe("new");
  });
});
