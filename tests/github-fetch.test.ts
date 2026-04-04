import { afterEach, describe, expect, it, vi } from "vitest";

const toastErrorMock = vi.fn();
const appendSessionNoticeMock = vi.fn(async () => {});
const getGithubPersonalAccessTokenMock = vi.fn<() => Promise<string | undefined>>(
  async () => undefined,
);

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

vi.mock("@/repo/github-token", () => ({
  getGithubPersonalAccessToken: getGithubPersonalAccessTokenMock,
}));

vi.mock("@/sessions/session-notices", () => ({
  appendSessionNotice: appendSessionNoticeMock,
}));

describe("github-fetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
    toastErrorMock.mockReset();
    appendSessionNoticeMock.mockReset();
    getGithubPersonalAccessTokenMock.mockReset();
    getGithubPersonalAccessTokenMock.mockResolvedValue(undefined);
  });

  it("blocks repeated requests until the primary rate limit reset", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T10:00:00.000Z"));

    const resetAtSeconds = Math.floor((Date.now() + 2 * 60_000) / 1000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          headers: {
            "Content-Type": "application/json",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(resetAtSeconds),
          },
          status: 403,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: "main" }), {
          headers: {
            "Content-Type": "application/json",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "59",
            "x-ratelimit-reset": String(resetAtSeconds + 3600),
          },
          status: 200,
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { GitHubRateLimitError, githubApiFetch } = await import("@/repo/github-fetch");

    await expect(githubApiFetch("/repos/acme/demo")).rejects.toBeInstanceOf(GitHubRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(githubApiFetch("/repos/acme/demo")).rejects.toBeInstanceOf(GitHubRateLimitError);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date((resetAtSeconds + 1) * 1000));

    const response = await githubApiFetch("/repos/acme/demo");
    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns cached responses while a rate-limit block is active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-29T10:00:00.000Z"));

    const resetAtSeconds = Math.floor((Date.now() + 2 * 60_000) / 1000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: "main" }), {
          headers: {
            "Content-Type": "application/json",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "59",
            "x-ratelimit-reset": String(resetAtSeconds + 3600),
          },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          headers: {
            "Content-Type": "application/json",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(resetAtSeconds),
          },
          status: 403,
        }),
      );

    const cacheStore = new Map<string, Response>();
    const cache = {
      match: vi.fn(async (url: string) => cacheStore.get(url)),
      put: vi.fn(async (url: string, response: Response) => {
        cacheStore.set(url, response);
      }),
    };

    vi.stubGlobal("caches", {
      open: vi.fn(async () => cache),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { githubApiFetch } = await import("@/repo/github-fetch");

    const freshResponse = await githubApiFetch("/repos/acme/demo");
    expect(freshResponse.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(Date.now() + 11 * 60_000));

    const cachedOnLimit = await githubApiFetch("/repos/acme/demo");
    expect(cachedOnLimit.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const cachedDuringBlock = await githubApiFetch("/repos/acme/demo");
    expect(cachedDuringBlock.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows an actionable toast and appends a session notice for GitHub rate limits", async () => {
    const blockedUntilMs = Date.parse("2026-03-29T10:02:00.000Z");
    const { GitHubRateLimitError, handleGithubError } = await import("@/repo/github-fetch");

    const handled = await handleGithubError(
      new GitHubRateLimitError({
        blockedUntilMs,
        kind: "primary",
      }),
      { sessionId: "session-1" },
    );

    expect(handled).toBe(true);
    expect(appendSessionNoticeMock).toHaveBeenCalledWith(
      "session-1",
      expect.any(GitHubRateLimitError),
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("GitHub requests are rate limited"),
      expect.objectContaining({
        action: expect.objectContaining({
          label: "Sign in with GitHub",
        }),
      }),
    );
  });

  it("falls back to anonymous GitHub API access when a token lacks repo access", async () => {
    getGithubPersonalAccessTokenMock.mockResolvedValue("github_pat_demo");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: "Resource not accessible by personal access token",
          }),
          {
            headers: {
              "Content-Type": "application/json",
              "x-ratelimit-limit": "5000",
              "x-ratelimit-remaining": "4999",
              "x-ratelimit-reset": "1900000000",
            },
            status: 403,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ default_branch: "main" }), {
          headers: {
            "Content-Type": "application/json",
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "59",
            "x-ratelimit-reset": "1900000000",
          },
          status: 200,
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { githubApiFetch } = await import("@/repo/github-fetch");
    const response = await githubApiFetch("/repos/acme/demo");

    expect(response.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer github_pat_demo",
        }),
      }),
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });
});
