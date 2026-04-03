import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const parseRepoRoutePathMock = vi.fn();
const resolveRepoIntentMock = vi.fn();
const toResolvedRepoSourceMock = vi.fn();

vi.mock("@gitinspect/ui/components/chat", () => ({
  Chat: (props: {
    repoSource?: { owner: string; ref?: string; repo: string };
    sessionId?: string;
  }) => (
    <div data-testid="chat-view">
      {props.sessionId
        ? `session:${props.sessionId}`
        : props.repoSource
          ? `${props.repoSource.owner}/${props.repoSource.repo}${props.repoSource.ref ? `@${props.repoSource.ref}` : ""}`
          : "global"}
    </div>
  ),
}));

vi.mock("@gitinspect/pi/repo/path-parser", () => ({
  parseRepoRoutePath: (path: string) => parseRepoRoutePathMock(path),
}));

vi.mock("@gitinspect/pi/repo/ref-resolver", () => ({
  resolveRepoIntent: (intent: unknown) => resolveRepoIntentMock(intent),
}));

vi.mock("@gitinspect/pi/repo/path-intent", () => ({
  toResolvedRepoSource: (location: unknown) => toResolvedRepoSourceMock(location),
}));

describe("chat routes", () => {
  it("renders the shared chat component on /chat", async () => {
    const { Route } = await import("@/routes/chat.index");

    const Component = Route.options.component;

    if (!Component) {
      throw new Error("Missing route component");
    }

    render(<Component />);

    expect(screen.getByTestId("chat-view").textContent).toBe("global");
  });

  it("renders loader-resolved data for repo root routes", async () => {
    const { Route } = await import("@/routes/$owner.$repo.index");
    vi.spyOn(Route, "useLoaderData").mockReturnValue({
      owner: "acme",
      ref: "main",
      refOrigin: "default",
      repo: "demo",
      resolvedRef: {
        apiRef: "heads/main",
        fullRef: "refs/heads/main",
        kind: "branch",
        name: "main",
      },
    });
    vi.spyOn(Route, "useParams").mockReturnValue({
      owner: "acme",
      repo: "demo",
    });

    const Component = Route.options.component;

    if (!Component) {
      throw new Error("Missing route component");
    }

    render(<Component />);

    expect(screen.getByTestId("chat-view").textContent).toBe("acme/demo@main");
  });

  it("renders loader-resolved slash refs for splat routes", async () => {
    const { Route } = await import("@/routes/$owner.$repo.$");
    vi.spyOn(Route, "useLoaderData").mockReturnValue({
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
    });
    vi.spyOn(Route, "useParams").mockReturnValue({
      _splat: "tree/feature/foo",
      owner: "acme",
      repo: "demo",
    });

    const Component = Route.options.component;

    if (!Component) {
      throw new Error("Missing route component");
    }

    render(<Component />);

    expect(screen.getByTestId("chat-view").textContent).toBe("acme/demo@feature/foo");
  });

  it("composes parser and resolver in the splat route loader", async () => {
    const { Route } = await import("@/routes/$owner.$repo.$");
    const loader = Route.options.loader;

    if (typeof loader !== "function") {
      throw new Error("Missing route loader");
    }

    parseRepoRoutePathMock.mockReturnValue({
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
    toResolvedRepoSourceMock.mockReturnValue({
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
    });

    await loader({
      abortController: new AbortController(),
      cause: "enter",
      context: undefined,
      deps: {},
      location: undefined,
      navigate: undefined,
      params: {
        _splat: "tree%2Ffeature%2Ffoo%2Fsrc%2Flib",
        owner: "acme",
        repo: "demo",
      },
      parentMatchPromise: Promise.resolve(undefined),
      preload: false,
      route: Route,
    } as never);

    expect(parseRepoRoutePathMock).toHaveBeenCalledWith("/acme/demo/tree/feature/foo/src/lib");
    expect(resolveRepoIntentMock).toHaveBeenCalledWith({
      owner: "acme",
      repo: "demo",
      tail: "feature/foo/src/lib",
      type: "tree-page",
    });
    expect(toResolvedRepoSourceMock).toHaveBeenCalled();
  });

  it("passes the session id into the shared chat component for session routes", async () => {
    const { Route } = await import("@/routes/chat.$sessionId");
    vi.spyOn(Route, "useParams").mockReturnValue({
      sessionId: "session-1",
    });

    const Component = Route.options.component;

    if (!Component) {
      throw new Error("Missing route component");
    }

    render(<Component />);

    expect(screen.getByTestId("chat-view").textContent).toBe("session:session-1");
  });
});
