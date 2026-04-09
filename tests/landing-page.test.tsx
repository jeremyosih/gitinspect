import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listRepositoriesMock = vi.fn(() => []);
const navigateMock = vi.fn();
const useSearchMock = vi.fn(() => ({}));
const parseRepoInputMock = vi.fn();
const resolveRepoIntentMock = vi.fn();

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: () => listRepositoriesMock(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a data-to={to}>{children}</a>
  ),
  useNavigate: () => navigateMock,
  useSearch: () => useSearchMock(),
}));

vi.mock("@gitinspect/db", () => ({
  listRepositories: () => listRepositoriesMock(),
}));

vi.mock("@/repo/path-parser", () => ({
  parseRepoInput: (raw: string) => parseRepoInputMock(raw),
}));

vi.mock("@/repo/ref-resolver", () => ({
  resolveRepoIntent: (source: unknown) => resolveRepoIntentMock(source),
}));

vi.mock("@/repo/github-fetch", () => ({
  handleGithubError: vi.fn(async () => false),
}));

vi.mock("@gitinspect/pi/repo/suggested-repos", () => ({
  SUGGESTED_REPOS: [
    { owner: "anomalyco", ref: "dev", refOrigin: "explicit", repo: "opencode" },
    { owner: "acme", ref: "main", refOrigin: "default", repo: "demo" },
    { owner: "foo", ref: "main", refOrigin: "default", repo: "bar" },
    { owner: "baz", ref: "main", refOrigin: "default", repo: "qux" },
  ],
}));

vi.mock("@gitinspect/ui/components/chat-logo", () => ({
  ChatLogo: () => <div>logo</div>,
}));

vi.mock("@gitinspect/ui/components/github-repo", () => ({
  GithubRepo: ({
    owner,
    ref,
    repo,
    to,
  }: {
    owner: string;
    ref?: string;
    repo: string;
    to: string;
  }) => (
    <div data-testid={`repo-${owner}-${repo}`} data-to={to}>
      {owner}/{repo}
      {ref ? `@${ref}` : ""}
    </div>
  ),
}));

vi.mock("@gitinspect/ui/components/input-group", () => ({
  InputGroup: ({ children, className }: React.ComponentProps<"div">) => (
    <div className={className}>{children}</div>
  ),
  InputGroupAddon: ({ children }: React.ComponentProps<"div">) => <div>{children}</div>,
  InputGroupButton: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
  InputGroupInput: (props: React.ComponentProps<"input">) => <input {...props} />,
  InputGroupText: ({ children }: React.ComponentProps<"span">) => <span>{children}</span>,
}));

vi.mock("@gitinspect/ui/components/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@gitinspect/ui/components/icons", () => ({
  Icons: {
    clock: () => <span>clock</span>,
    gitHub: () => <span>github</span>,
    sparkles: () => <span>sparkles</span>,
  },
}));

describe("LandingPage", () => {
  beforeEach(() => {
    listRepositoriesMock.mockReset();
    navigateMock.mockReset();
    parseRepoInputMock.mockReset();
    resolveRepoIntentMock.mockReset();
    useSearchMock.mockReset();
    useSearchMock.mockReturnValue({});
  });

  it("preserves explicit refs for suggested repos", async () => {
    const { LandingPage } = await import("@/components/landing-page");

    render(<LandingPage />);

    expect(screen.getByTestId("repo-anomalyco-opencode").getAttribute("data-to")).toBe(
      "/anomalyco/opencode/tree/dev",
    );
  });

  it("navigates using the resolved repo source from the landing form", async () => {
    parseRepoInputMock.mockReturnValue({
      owner: "acme",
      repo: "demo",
      tail: "feature/foo/src/lib",
      type: "tree-page",
    });
    resolveRepoIntentMock.mockResolvedValue({
      owner: "acme",
      ref: "feature/foo",
      refOrigin: "explicit",
      repo: "demo",
      resolvedRef: {
        apiRef: "heads/feature/foo",
        fullRef: "refs/heads/feature/foo",
        kind: "branch",
        name: "feature/foo",
      },
      view: "tree",
    });

    const { LandingPage } = await import("@/components/landing-page");

    render(<LandingPage />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText("GitHub repository URL or owner/repo"), {
        target: { value: "https://github.com/acme/demo/tree/feature/foo/src/lib" },
      });
      fireEvent.click(screen.getByLabelText("Continue to workspace"));
    });

    expect(resolveRepoIntentMock).toHaveBeenCalledWith({
      owner: "acme",
      repo: "demo",
      tail: "feature/foo/src/lib",
      type: "tree-page",
    });
    expect(navigateMock).toHaveBeenCalledWith({
      search: {
        settings: undefined,
        sidebar: undefined,
      },
      to: "/acme/demo/tree/feature/foo",
    });
  });
});
