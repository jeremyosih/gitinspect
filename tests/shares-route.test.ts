import { beforeEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ getSession: vi.fn(), sharing: vi.fn() }));
vi.mock("@gitinspect/auth", () => ({ auth: { api: { getSession: state.getSession } } }));
vi.mock("@/lib/sharing-service.server", () => ({ sharingServiceRequest: state.sharing }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
const payload = {
  session: {
    id: "session-1",
    title: "Share",
    createdAt: "now",
    updatedAt: "now",
    apiKey: "private",
  },
  messages: [
    {
      id: "m1",
      role: "user",
      content: "Hello",
      sessionId: "session-1",
      status: "completed",
      order: 0,
      timestamp: 1,
      apiKey: "private",
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  state.getSession.mockResolvedValue({ user: { id: "cookie-user", ghId: "gh_alice" } });
  state.sharing.mockResolvedValue(Response.json({ ok: true }));
});
async function handlers() {
  const { Route } = await import("@/routes/api/shares.$sessionId");
  return (Route as any).server.handlers;
}
describe("share route bridge", () => {
  it("allows public reads without login and delegates to public storage only", async () => {
    await (
      await handlers()
    ).GET({
      params: { sessionId: "session-1" },
      request: new Request("https://gitinspect.com/api/shares/session-1?view=public"),
    });
    expect(state.getSession).not.toHaveBeenCalled();
    expect(state.sharing).toHaveBeenCalledWith({ sessionId: "session-1", publicView: true });
  });
  it("authenticates publishing, strips unrelated fields, and never requires a paid plan", async () => {
    const response = await (
      await handlers()
    ).PUT({
      params: { sessionId: "session-1" },
      request: new Request("https://gitinspect.com/api/shares/session-1", {
        method: "PUT",
        headers: { origin: "https://gitinspect.com" },
        body: JSON.stringify(payload),
      }),
    });
    expect(response.status).toBe(200);
    const call = state.sharing.mock.calls[0]![0];
    expect(call.ownerUserId).toBe("gh_alice");
    expect(call.body).not.toContain("apiKey");
    expect(JSON.parse(call.body).session).not.toHaveProperty("ownerUserId");
  });
  it("rejects signed-out, cross-origin, and mixed-session mutations before storage", async () => {
    const api = await handlers();
    const make = (body: unknown, origin = "https://gitinspect.com") =>
      new Request("https://gitinspect.com/api/shares/session-1", {
        method: "PUT",
        headers: { origin },
        body: JSON.stringify(body),
      });
    state.getSession.mockResolvedValue(null);
    expect(
      (await api.PUT({ params: { sessionId: "session-1" }, request: make(payload) })).status,
    ).toBe(401);
    expect(
      (
        await api.PUT({
          params: { sessionId: "session-1" },
          request: make(payload, "https://attacker.test"),
        })
      ).status,
    ).toBe(403);
    state.getSession.mockResolvedValue({ user: { id: "alice" } });
    expect(
      (
        await api.PUT({
          params: { sessionId: "session-1" },
          request: make({
            ...payload,
            messages: [{ ...payload.messages[0], sessionId: "session-2" }],
          }),
        })
      ).status,
    ).toBe(400);
    expect(state.sharing).not.toHaveBeenCalled();
  });
});
