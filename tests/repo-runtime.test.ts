import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepoRuntime, execInRepoShell } from "@/repo/repo-runtime";
import { installMockRepoFetch, TEST_REPO_SOURCE } from "./repo-test-utils";

const resolveRegisteredGitHubAccessMock = vi.fn();

vi.mock("@/repo/github-access", () => ({
  resolveRegisteredGitHubAccess: () => resolveRegisteredGitHubAccessMock(),
}));

describe("repo runtime", () => {
  beforeEach(() => {
    installMockRepoFetch();
    resolveRegisteredGitHubAccessMock.mockReset();
    resolveRegisteredGitHubAccessMock.mockResolvedValue({
      ok: true as const,
      source: "pat" as const,
      token: "runtime-token-1",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves cwd across shell calls", async () => {
    const runtime = createRepoRuntime(TEST_REPO_SOURCE);

    await execInRepoShell(runtime, "cd src");

    expect(runtime.getCwd()).toBe("/src");

    const result = await execInRepoShell(runtime, "pwd");

    expect(result.stdout.trim()).toBe("/src");
  });

  it("resolves the latest GitHub auth lazily for runtime reads", async () => {
    let currentToken = "runtime-token-1";
    resolveRegisteredGitHubAccessMock.mockImplementation(async () => ({
      ok: true as const,
      source: "pat" as const,
      token: currentToken,
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("git/ref/heads/main")) {
        return new Response(JSON.stringify({ object: { sha: "commit-sha", type: "commit" } }), {
          headers: {
            "Content-Type": "application/json",
            "x-ratelimit-limit": "5000",
            "x-ratelimit-remaining": "4999",
            "x-ratelimit-reset": "1700000000",
          },
          status: 200,
        });
      }

      if (url.includes("commits/commit-sha")) {
        return new Response(
          JSON.stringify({
            commit: { tree: { sha: "tree-sha" } },
            sha: "commit-sha",
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "4999",
              "x-ratelimit-reset": "1700000000",
            },
            status: 200,
          },
        );
      }

      if (url.includes("git/trees/tree-sha"))
        return Response.json({
          sha: "tree-sha",
          truncated: false,
          tree: [{ path: "README.md", mode: "100644", type: "blob", sha: "readme-sha", size: 8 }],
        });
      if (url.includes("git/blobs/readme-sha")) {
        return new Response(
          JSON.stringify({
            content: btoa("# hello\n"),
            download_url: "https://raw.githubusercontent.com/test-owner/test-repo/main/README.md",
            encoding: "base64",
            name: "README.md",
            path: "README.md",
            sha: "readme-sha",
            size: 8,
            type: "file",
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "4999",
              "x-ratelimit-reset": "1700000000",
            },
            status: 200,
          },
        );
      }

      return new Response("Not Found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const runtime = createRepoRuntime(TEST_REPO_SOURCE);

    await runtime.fs.readFile("README.md");
    currentToken = "runtime-token-2";
    runtime.refresh();
    await runtime.fs.readFile("README.md");

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer runtime-token-1",
        }),
      }),
    );
    expect(fetchMock.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer runtime-token-2",
        }),
      }),
    );
  });
});
