import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const githubApiFetchMock = vi.fn(
  async () =>
    new Response(JSON.stringify({ language: "TypeScript", stargazers_count: 1234 }), {
      headers: {
        "Content-Type": "application/json",
      },
      status: 200,
    }),
);

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
    React.createElement("a", props, children),
}));

vi.mock("@gitinspect/ui/components/icons", () => ({
  Icons: {
    gitHub: () => React.createElement("span", undefined, "GitHub"),
  },
}));

vi.mock("@gitinspect/ui/components/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) =>
    React.createElement("button", { type: "button" }, children),
}));

vi.mock("@gitinspect/ui/components/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
  TooltipContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children),
}));

vi.mock("@gitinspect/runtime/repo/github-fetch", () => ({
  githubApiFetch: githubApiFetchMock,
  handleGithubError: vi.fn(async () => false),
  openGithubTokenSettings: vi.fn(),
}));

vi.mock("@gitinspect/runtime/repo/github-token", () => ({
  getGithubPersonalAccessToken: vi.fn(async () => "token"),
}));

describe("GithubRepo", () => {
  beforeEach(() => {
    githubApiFetchMock.mockClear();
  });

  it("loads public metadata through the generic helper", async () => {
    const { GithubRepo } = await import("@/components/github-repo");

    render(<GithubRepo owner="acme" ref="main" refOrigin="default" repo="demo" to="/acme/demo" />);

    await waitFor(() => {
      expect(githubApiFetchMock).toHaveBeenCalledWith("/repos/acme/demo", {
        access: "public",
        signal: expect.any(AbortSignal),
      });
    });
  });

  it("shows refs in brackets", async () => {
    const { GithubRepo } = await import("@/components/github-repo");

    render(
      <GithubRepo
        owner="acme"
        ref="feature/foo"
        refOrigin="explicit"
        repo="demo"
        to="/acme/demo/feature/foo"
      />,
    );

    expect(screen.getByText("[feature/foo]")).toBeTruthy();
  });

  it("shows default refs in brackets too", async () => {
    const { GithubRepo } = await import("@/components/github-repo");

    render(<GithubRepo owner="acme" ref="main" refOrigin="default" repo="demo" to="/acme/demo" />);

    expect(screen.getByText("[main]")).toBeTruthy();
  });
});
