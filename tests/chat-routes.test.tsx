import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/chat", () => ({
  Chat: (props: {
    repoSource?: { owner: string; ref: string; repo: string }
    sessionId?: string
  }) => (
    <div data-testid="chat-view">
      {props.sessionId
        ? `session:${props.sessionId}`
        : props.repoSource
        ? `${props.repoSource.owner}/${props.repoSource.repo}@${props.repoSource.ref}`
        : "global"}
    </div>
  ),
}))

describe("chat routes", () => {
  it("renders the shared chat component on /chat", async () => {
    const { Route } = await import("@/routes/chat.index")

    const Component = Route.options.component

    if (!Component) {
      throw new Error("Missing route component")
    }

    render(<Component />)

    expect(screen.getByTestId("chat-view").textContent).toBe("global")
  })

  it("passes repo context into the shared chat component for repo routes", async () => {
    const { Route } = await import("@/routes/$owner.$repo.index")
    vi.spyOn(Route, "useParams").mockReturnValue({
      owner: "acme",
      repo: "demo",
    })

    const Component = Route.options.component

    if (!Component) {
      throw new Error("Missing route component")
    }

    render(<Component />)

    expect(screen.getByTestId("chat-view").textContent).toBe("acme/demo@main")
  })

  it("passes the session id into the shared chat component for session routes", async () => {
    const { Route } = await import("@/routes/chat.$sessionId")
    vi.spyOn(Route, "useParams").mockReturnValue({
      sessionId: "session-1",
    })

    const Component = Route.options.component

    if (!Component) {
      throw new Error("Missing route component")
    }

    render(<Component />)

    expect(screen.getByTestId("chat-view").textContent).toBe("session:session-1")
  })
})
