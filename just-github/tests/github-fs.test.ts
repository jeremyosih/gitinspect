//just-github test - DO NOT Delete.
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { GitHubFs } from "../src/github-fs.js";
import { GitHubFsError } from "../src/types.js";
import type { GitHubResolvedRef } from "../src/refs.js";

// Mock responses
const mockFileContent = {
  name: "index.ts",
  path: "src/index.ts",
  sha: "abc123",
  size: 42,
  type: "file",
  content: btoa("export const hello = 'world';"),
  encoding: "base64",
  download_url: "https://raw.githubusercontent.com/owner/repo/main/src/index.ts",
};

const mockDirContent = [
  {
    name: "index.ts",
    path: "src/index.ts",
    sha: "abc123",
    size: 42,
    type: "file",
    download_url: null,
  },
  { name: "utils", path: "src/utils", sha: "def456", size: 0, type: "dir", download_url: null },
];

const mockTreeResponse = {
  sha: "tree-sha",
  tree: [
    { path: "src", mode: "040000", type: "tree", sha: "dir-sha" },
    { path: "src/index.ts", mode: "100644", type: "blob", sha: "abc123", size: 42 },
    { path: "src/utils", mode: "040000", type: "tree", sha: "utils-sha" },
    { path: "src/utils/helper.ts", mode: "100644", type: "blob", sha: "helper-sha", size: 30 },
    { path: "README.md", mode: "100644", type: "blob", sha: "readme-sha", size: 100 },
    { path: "link", mode: "120000", type: "blob", sha: "link-sha", size: 10 },
  ],
  truncated: false,
};

const mockCommitResponse = {
  sha: "commit-sha",
  commit: { tree: { sha: "tree-sha" } },
};

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

function mockFetch(handlers: Record<string, any>) {
  return vi.fn(async (url: string | URL | Request) => {
    const urlStr = typeof url === "string" ? url : url.toString();

    for (const [pattern, response] of Object.entries(handlers)) {
      if (urlStr.includes(pattern)) {
        if (response === null) {
          return new Response("Not Found", {
            status: 404,
            headers: {
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "4999",
              "x-ratelimit-reset": "1700000000",
            },
          });
        }
        if (typeof response === "string") {
          return new Response(response, {
            status: 200,
            headers: {
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "4999",
              "x-ratelimit-reset": "1700000000",
            },
          });
        }
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4999",
            "x-ratelimit-reset": "1700000000",
          },
        });
      }
    }
    return new Response("Not Found", { status: 404 });
  });
}

describe("GitHubFs", () => {
  let fs: GitHubFs;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = mockFetch({
      "contents/src/index.ts": mockFileContent,
      "contents/src?ref=commit-sha": mockDirContent,
      "contents/nonexistent": null,
      "git/ref/heads/main": { object: { sha: "commit-sha", type: "commit" } },
      "commits/commit-sha": mockCommitResponse,
      "git/trees/tree-sha?recursive=1": mockTreeResponse,
    });
    vi.stubGlobal("fetch", fetchSpy);

    fs = new GitHubFs({
      owner: "test-owner",
      repo: "test-repo",
      ref: MAIN_REF,
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
      await expect(fs.readFile("nonexistent")).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("throws EISDIR for directories", async () => {
      fetchSpy = mockFetch({
        "git/ref/heads/main": { object: { sha: "commit-sha", type: "commit" } },
        "commits/commit-sha": mockCommitResponse,
        "contents/src?ref=commit-sha": mockDirContent,
      });
      vi.stubGlobal("fetch", fetchSpy);
      fs = new GitHubFs({ owner: "o", repo: "r", ref: MAIN_REF });

      await expect(fs.readFile("src")).rejects.toMatchObject({ code: "EISDIR" });
    });

    it("caches content by SHA after first read", async () => {
      // Load the tree first so we have SHA info
      await fs.tree();

      // Read the file
      await fs.readFile("src/index.ts");

      // Reset fetch to track new calls
      const callCount = fetchSpy.mock.calls.length;

      // Second read should use cache
      await fs.readFile("src/index.ts");
      // No new Contents API calls (only checks if url contains contents/)
      const newCalls = fetchSpy.mock.calls.slice(callCount);
      const contentsCalls = newCalls.filter((c: any) => c[0].includes("contents/"));
      expect(contentsCalls.length).toBe(0);
    });
  });

  describe("readdir", () => {
    it("lists directory entries", async () => {
      const entries = await fs.readdir("src");
      expect(entries).toEqual(["index.ts", "utils"]);
    });

    it("lists with types", async () => {
      const entries = await fs.readdirWithFileTypes("src");
      expect(entries).toEqual([
        { name: "index.ts", isFile: true, isDirectory: false, isSymbolicLink: false },
        { name: "utils", isFile: false, isDirectory: true, isSymbolicLink: false },
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
          sha: "tag-commit-sha",
          commit: { tree: { sha: "tree-sha" } },
        },
        "git/trees/tree-sha?recursive=1": mockTreeResponse,
      });
      vi.stubGlobal("fetch", fetchSpy);
      fs = new GitHubFs({ owner: "o", repo: "r", ref: TAG_REF });

      await expect(fs.tree()).resolves.toContain("src/index.ts");
    });

    it("throws a clear error for annotated tags that target trees", async () => {
      fetchSpy = mockFetch({
        "git/ref/tags/v1.2.3": { object: { sha: "tag-object-sha", type: "tag" } },
        "git/tags/tag-object-sha": { object: { sha: "tree-sha", type: "tree" } },
      });
      vi.stubGlobal("fetch", fetchSpy);
      fs = new GitHubFs({ owner: "o", repo: "r", ref: TAG_REF });

      await expect(fs.tree()).rejects.toMatchObject({
        code: "ENOTSUP",
        message: "gitinspect v0 does not support annotated tags that target trees or blobs.",
      });
    });

    it("correctly identifies symlinks in tree", async () => {
      await fs.tree(); // load tree
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
      const rl = fs.rateLimit;
      expect(rl).toBeDefined();
      expect(rl!.limit).toBe(5000);
      expect(rl!.remaining).toBe(4999);
    });

    it("blocks repeated reads until the primary rate limit reset", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-29T10:00:00.000Z"));

      const resetAtSeconds = Math.floor((Date.now() + 2 * 60_000) / 1000);
      let shouldRateLimit = true;
      fetchSpy = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();

        if (urlStr.includes("git/ref/heads/main")) {
          if (shouldRateLimit) {
            shouldRateLimit = false;
            return new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
              status: 403,
              headers: {
                "Content-Type": "application/json",
                "x-ratelimit-limit": "60",
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(resetAtSeconds),
              },
            });
          }

          return new Response(JSON.stringify({ object: { sha: "commit-sha", type: "commit" } }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "x-ratelimit-limit": "60",
              "x-ratelimit-remaining": "59",
              "x-ratelimit-reset": String(resetAtSeconds + 3600),
            },
          });
        }

        if (urlStr.includes("commits/commit-sha")) {
          return new Response(JSON.stringify(mockCommitResponse), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "x-ratelimit-limit": "60",
              "x-ratelimit-remaining": "59",
              "x-ratelimit-reset": String(resetAtSeconds + 3600),
            },
          });
        }

        return new Response(JSON.stringify(mockFileContent), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "59",
            "x-ratelimit-reset": String(resetAtSeconds + 3600),
          },
        });
      });
      vi.stubGlobal("fetch", fetchSpy);
      fs = new GitHubFs({ owner: "o", repo: "r", ref: MAIN_REF });

      await expect(fs.readFile("src/index.ts")).rejects.toMatchObject({
        code: "EACCES",
        message: expect.stringContaining("GitHub API rate limit exceeded"),
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      await expect(fs.readFile("src/index.ts")).rejects.toMatchObject({
        code: "EACCES",
        message: expect.stringContaining("GitHub API rate limit exceeded"),
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date((resetAtSeconds + 1) * 1000));

      const content = await fs.readFile("src/index.ts");
      expect(content).toBe("export const hello = 'world';");
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it("falls back to anonymous reads when a token cannot access a public repo", async () => {
      fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        const headers = init?.headers as Record<string, string> | undefined;

        if (urlStr.includes("git/ref/heads/main")) {
          return new Response(JSON.stringify({ object: { sha: "commit-sha", type: "commit" } }), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "4999",
              "x-ratelimit-reset": "1900000000",
            },
          });
        }

        if (urlStr.includes("commits/commit-sha")) {
          return new Response(JSON.stringify(mockCommitResponse), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "4999",
              "x-ratelimit-reset": "1900000000",
            },
          });
        }

        if (headers?.Authorization) {
          return new Response(
            JSON.stringify({
              message: "Resource not accessible by personal access token",
            }),
            {
              status: 403,
              headers: {
                "Content-Type": "application/json",
                "x-ratelimit-limit": "5000",
                "x-ratelimit-remaining": "4999",
                "x-ratelimit-reset": "1900000000",
              },
            },
          );
        }

        return new Response(JSON.stringify(mockFileContent), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "59",
            "x-ratelimit-reset": "1900000000",
          },
        });
      });
      vi.stubGlobal("fetch", fetchSpy);
      fs = new GitHubFs({
        owner: "o",
        repo: "r",
        ref: MAIN_REF,
        token: "github_pat_demo",
      });

      const content = await fs.readFile("src/index.ts");

      expect(content).toBe("export const hello = 'world';");
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      expect(fetchSpy.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer github_pat_demo",
          }),
        }),
      );
      expect(fetchSpy.mock.calls[3]?.[1]).toEqual(
        expect.objectContaining({
          headers: expect.not.objectContaining({
            Authorization: expect.any(String),
          }),
        }),
      );
    });
  });

  describe("no API calls on construction", () => {
    it("does not fetch anything when instantiated", () => {
      const spy = vi.fn();
      vi.stubGlobal("fetch", spy);
      new GitHubFs({ owner: "o", repo: "r", ref: MAIN_REF });
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
