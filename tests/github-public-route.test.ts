import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  env: {
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
  },
}));

vi.mock("@gitinspect/env/server", () => ({
  env: state.env,
}));

describe("/api/github/public route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects requests without owner and repo", async () => {
    const { Route } = await import("@/routes/api/github/public");

    const response = await Route.options.server.handlers.GET({
      request: new Request("https://gitinspect.com/api/github/public"),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "owner and repo are required" });
  });

  it("returns public repo metadata with cache headers", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            default_branch: "main",
            language: "TypeScript",
            private: false,
            stargazers_count: 1234,
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 200,
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { Route } = await import("@/routes/api/github/public");

    const response = await Route.options.server.handlers.GET({
      request: new Request("https://gitinspect.com/api/github/public?owner=acme&repo=demo"),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
        }),
      }),
    );
    expect(response.headers.get("cache-control")).toContain("stale-while-revalidate");
    await expect(response.json()).resolves.toEqual({
      default_branch: "main",
      language: "TypeScript",
      stargazers_count: 1234,
    });
  });

  it("hides private repositories from the public metadata endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              default_branch: "main",
              language: "TypeScript",
              private: true,
              stargazers_count: 1234,
            }),
            {
              headers: {
                "Content-Type": "application/json",
              },
              status: 200,
            },
          ),
      ),
    );

    const { Route } = await import("@/routes/api/github/public");

    const response = await Route.options.server.handlers.GET({
      request: new Request("https://gitinspect.com/api/github/public?owner=acme&repo=private-demo"),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Repository metadata is unavailable" });
  });
});
