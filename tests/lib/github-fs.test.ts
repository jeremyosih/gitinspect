//just-github test - DO NOT Delete.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubFs } from "@/lib/github/github-fs";
import type { GitHubResolvedRef } from "@/lib/github/refs";
import { GitHubFsError } from "@/lib/github/types";

const mockFileContent = {
  content: btoa("export const hello = 'world';"),
  download_url: "https://raw.githubusercontent.com/owner/repo/main/src/index.ts",
  encoding: "base64",
  name: "index.ts",
  path: "src/index.ts",
  sha: "abc123",
  size: 42,
  type: "file",
} as const;

const mockDirContent = [
  {
    download_url: null,
    name: "index.ts",
    path: "src/index.ts",
    sha: "abc123",
    size: 42,
    type: "file",
  },
  {
    download_url: null,
    name: "utils",
    path: "src/utils",
    sha: "def456",
    size: 0,
    type: "dir",
  },
] as const;

const mockRootDirContent = [
  {
    download_url: null,
    name: "src",
    path: "src",
    sha: "dir-sha",
    size: 0,
    type: "dir",
  },
  {
    download_url: null,
    name: "README.md",
    path: "README.md",
    sha: "readme-sha",
    size: 100,
    type: "file",
  },
  {
    download_url: null,
    name: "link",
    path: "link",
    sha: "link-sha",
    size: 10,
    type: "symlink",
  },
] as const;

const mockTreeResponse = {
  sha: "tree-sha",
  tree: [
    { mode: "040000", path: "src", sha: "dir-sha", type: "tree" },
    { mode: "100644", path: "src/index.ts", sha: "abc123", size: 42, type: "blob" },
    { mode: "040000", path: "src/utils", sha: "utils-sha", type: "tree" },
    {
      mode: "100644",
      path: "src/utils/helper.ts",
      sha: "helper-sha",
      size: 30,
      type: "blob",
    },
    { mode: "100644", path: "README.md", sha: "readme-sha", size: 100, type: "blob" },
    { mode: "120000", path: "link", sha: "link-sha", size: 10, type: "blob" },
  ],
  truncated: false,
} as const;

const mockCommitResponse = {
  commit: { tree: { sha: "tree-sha" } },
  sha: "commit-sha",
} as const;

const MAIN_REF: GitHubResolvedRef = {
  apiRef: "heads/main",
  fullRef: "refs/heads/main",
  kind: "branch",
  name: "main",
};

const TAG_REF: GitHubResolvedRef = {
  apiRef: "tags/v1.2.3",
  fullRef: "refs/tags/v1.2.3",
  kind: "tag",
  name: "v1.2.3",
};

function requestToString(request: string | URL | Request): string {
  return typeof request === "string" ? request : request.toString();
}

function mockFetch(handlers: Record<string, object | string | null>) {
  return vi.fn(async (request: string | URL | Request) => {
    const url = requestToString(request);

    for (const [pattern, response] of Object.entries(handlers)) {
      if (!url.includes(pattern)) {
        continue;
      }

      if (response === null) {
        return new Response("Not Found", {
          headers: {
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4999",
            "x-ratelimit-reset": "1700000000",
          },
          status: 404,
        });
      }

      if (typeof response === "string") {
        return new Response(response, {
          headers: {
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4999",
            "x-ratelimit-reset": "1700000000",
          },
          status: 200,
        });
      }

      return new Response(JSON.stringify(response), {
        headers: {
          "Content-Type": "application/json",
          "x-ratelimit-limit": "5000",
          "x-ratelimit-remaining": "4999",
          "x-ratelimit-reset": "1700000000",
        },
        status: 200,
      });
    }

    return new Response("Not Found", { status: 404 });
  });
}

describe("GitHubFs", () => {
  let fs: GitHubFs;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = mockFetch({
      "git/ref/heads/main": { object: { sha: "commit-sha", type: "commit" } },
      "commits/commit-sha": mockCommitResponse,
      "contents/nonexistent": null,
      "contents/src/index.ts": mockFileContent,
      "contents/src?ref=commit-sha": mockDirContent,
      "contents/?ref=commit-sha": mockRootDirContent,
      "git/trees/tree-sha?recursive=1": mockTreeResponse,
    });
    vi.stubGlobal("fetch", fetchSpy);

    fs = new GitHubFs({
      owner: "test-owner",
      ref: MAIN_REF,
      repo: "test-repo",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("readFile", () => {
    it("reads a file via Contents API", async () => {
      const content = await fs.readFile("src/index.ts");
      expect(content).toBe("export const hello = 'world';");
    });

    it("throws ENOENT for missing files", async () => {
      await expect(fs.readFile("nonexistent")).rejects.toThrow(GitHubFsError);
      await expect(fs.readFile("nonexistent")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    it("throws EISDIR for directories", async () => {
      fetchSpy = mockFetch({
        "git/ref/heads/main": { object: { sha: "commit-sha", type: "commit" } },
        "commits/commit-sha": mockCommitResponse,
        "contents/src?ref=commit-sha": mockDirContent,
      });
      vi.stubGlobal("fetch", fetchSpy);
      fs = new GitHubFs({ owner: "o", ref: MAIN_REF, repo: "r" });

      await expect(fs.readFile("src")).rejects.toMatchObject({ code: "EISDIR" });
    });

    it("caches content by SHA after first read", async () => {
      await fs.tree();
      await fs.readFile("src/index.ts");

      const callCount = fetchSpy.mock.calls.length;

      await fs.readFile("src/index.ts");

      const newCalls = fetchSpy.mock.calls.slice(callCount);
      const contentsCalls = newCalls.filter(([request]) =>
        requestToString(request).includes("contents/"),
      );
      expect(contentsCalls.length).toBe(0);
    });
  });

  describe("readdir", () => {
    it("treats dot as the repository root", async () => {
      const entries = await fs.readdir(".");
      expect(entries).toEqual(["src", "README.md", "link"]);
    });

    it("lists directory entries", async () => {
      const entries = await fs.readdir("src");
      expect(entries).toEqual(["index.ts", "utils"]);
    });

    it("lists with types", async () => {
      const entries = await fs.readdirWithFileTypes("src");
      expect(entries).toEqual([
        { isDirectory: false, isFile: true, isSymbolicLink: false, name: "index.ts" },
        { isDirectory: true, isFile: false, isSymbolicLink: false, name: "utils" },
      ]);
    });
  });

  describe("stat", () => {
    it("returns file stat from Contents API", async () => {
      const info = await fs.stat("src/index.ts");
      expect(info.isFile).toBe(true);
      expect(info.isDirectory).toBe(false);
      expect(info.size).toBe(42);
    });

    it("returns dir stat for root", async () => {
      const info = await fs.stat("/");
      expect(info.isDirectory).toBe(true);
      expect(info.isFile).toBe(false);
    });

    it("throws ENOENT for missing paths", async () => {
      await expect(fs.stat("nonexistent")).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  describe("exists", () => {
    it("returns true for existing files", async () => {
      expect(await fs.exists("src/index.ts")).toBe(true);
    });

    it("returns false for missing files", async () => {
      expect(await fs.exists("nonexistent")).toBe(false);
    });
  });

  describe("tree", () => {
    it("returns all paths from the tree", async () => {
      const paths = await fs.tree();
      expect(paths).toContain("src/index.ts");
      expect(paths).toContain("README.md");
      expect(paths).toContain("src/utils/helper.ts");
    });

    it("loads trees for lightweight tags", async () => {
      fetchSpy = mockFetch({
        "git/ref/tags/v1.2.3": { object: { sha: "tag-commit-sha", type: "commit" } },
        "commits/tag-commit-sha": {
          commit: { tree: { sha: "tree-sha" } },
          sha: "tag-commit-sha",
        },
        "git/trees/tree-sha?recursive=1": mockTreeResponse,
      });
      vi.stubGlobal("fetch", fetchSpy);
      fs = new GitHubFs({ owner: "o", ref: TAG_REF, repo: "r" });

      await expect(fs.tree()).resolves.toContain("src/index.ts");
    });

    it("correctly identifies symlinks in tree", async () => {
      await fs.tree();
      const info = await fs.stat("link");
      expect(info.isSymbolicLink).toBe(true);
    });

    it("caches tree - second call makes no API requests", async () => {
      await fs.tree();
      const callCount = fetchSpy.mock.calls.length;

      await fs.tree();
      expect(fetchSpy.mock.calls.length).toBe(callCount);
    });
  });

  describe("refresh", () => {
    it("clears caches so next access re-fetches", async () => {
      await fs.tree();
      const callCount = fetchSpy.mock.calls.length;

      fs.refresh();
      await fs.tree();
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(callCount);
    });
  });

  describe("rateLimit", () => {
    it("tracks rate limit info from responses", async () => {
      await fs.readFile("src/index.ts");
      const rateLimit = fs.rateLimit;
      expect(rateLimit).toBeDefined();
      expect(rateLimit?.limit).toBe(5000);
      expect(rateLimit?.remaining).toBe(4999);
    });

    it("blocks repeated reads until the primary rate limit reset", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-29T10:00:00.000Z"));

      const resetAtSeconds = Math.floor((Date.now() + 2 * 60_000) / 1000);
      let shouldRateLimit = true;
      fetchSpy = vi.fn(async (url: string | URL | Request) => {
        const urlStr = requestToString(url);

        if (urlStr.includes("git/ref/heads/main")) {
          if (shouldRateLimit) {
            shouldRateLimit = false;
            return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
              headers: {
                "Content-Type": "application/json",
                "x-ratelimit-limit": "60",
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(resetAtSeconds),
              },
              status: 403,
            });
          }

          return new Response(JSON.stringify({ object: { sha: "commit-sha", type: "commit" } }), {
            headers: {
              "Content-Type": "application/json",
              "x-ratelimit-limit": "60",
              "x-ratelimit-remaining": "59",
              "x-ratelimit-reset": String(resetAtSeconds + 3600),
            },
            status: 200,
          });
        }

        if (urlStr.includes("commits/commit-sha")) {
          return new Response(JSON.stringify(mockCommitResponse), {
            headers: {
              "Content-Type": "application/json",
              "x-ratelimit-limit": "60",
              "x-ratelimit-remaining": "59",
              "x-ratelimit-reset": String(resetAtSeconds + 3600),
            },
            status: 200,
          });
        }

        return new Response(JSON.stringify(mockFileContent), {
          headers: {
            "Content-Type": "application/json",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "59",
            "x-ratelimit-reset": String(resetAtSeconds + 3600),
          },
          status: 200,
        });
      });
      vi.stubGlobal("fetch", fetchSpy);
      fs = new GitHubFs({ owner: "o", ref: MAIN_REF, repo: "r" });

      await expect(fs.readFile("README.md")).rejects.toMatchObject({
        code: "EACCES",
        kind: "rate_limit",
      });

      await expect(fs.readFile("README.md")).rejects.toMatchObject({
        code: "EACCES",
        kind: "rate_limit",
      });

      vi.advanceTimersByTime(2 * 60_000);

      await expect(fs.readFile("src/index.ts")).resolves.toBe("export const hello = 'world';");
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });
  });
});
