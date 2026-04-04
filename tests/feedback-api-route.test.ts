import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  createFeedbackIssue: vi.fn(),
  env: {
    CORS_ORIGIN: "https://gitinspect.com",
    FEEDBACK_GITHUB_OWNER: "acme",
    FEEDBACK_GITHUB_REPO: "gitinspect",
    FEEDBACK_GITHUB_TOKEN: "github-token",
  },
}));

vi.mock("@gitinspect/env/server", () => ({
  env: state.env,
}));

vi.mock("@/lib/feedback.server", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/feedback.server")>("@/lib/feedback.server");

  return {
    ...actual,
    createFeedbackIssue: state.createFeedbackIssue,
  };
});

describe("/api/feedback route", () => {
  beforeEach(() => {
    state.createFeedbackIssue.mockReset();
    state.env.CORS_ORIGIN = "https://gitinspect.com";
    state.env.FEEDBACK_GITHUB_OWNER = "acme";
    state.env.FEEDBACK_GITHUB_REPO = "gitinspect";
    state.env.FEEDBACK_GITHUB_TOKEN = "github-token";
  });

  it("returns 503 when feedback env is missing", async () => {
    state.env.FEEDBACK_GITHUB_TOKEN = undefined;
    const { Route } = await import("@/routes/api/feedback");

    const response = await Route.options.server.handlers.POST({
      request: new Request("https://gitinspect.com/api/feedback", {
        body: JSON.stringify({
          includeDiagnostics: false,
          message: "Missing configuration",
          sentiment: "neutral",
          website: "",
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://gitinspect.com",
        },
        method: "POST",
      }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Feedback is not configured" });
  });

  it("rejects invalid payloads", async () => {
    const { Route } = await import("@/routes/api/feedback");

    const response = await Route.options.server.handlers.POST({
      request: new Request("https://gitinspect.com/api/feedback", {
        body: JSON.stringify({
          includeDiagnostics: false,
          message: "bad",
          sentiment: "neutral",
          website: "",
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://gitinspect.com",
        },
        method: "POST",
      }),
    });

    expect(response.status).toBe(400);
    expect(state.createFeedbackIssue).not.toHaveBeenCalled();
  });

  it("rejects filled honeypot submissions", async () => {
    const { Route } = await import("@/routes/api/feedback");

    const response = await Route.options.server.handlers.POST({
      request: new Request("https://gitinspect.com/api/feedback", {
        body: JSON.stringify({
          includeDiagnostics: false,
          message: "Real feedback body",
          sentiment: "neutral",
          website: "https://spam.example",
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://gitinspect.com",
        },
        method: "POST",
      }),
    });

    expect(response.status).toBe(400);
    expect(state.createFeedbackIssue).not.toHaveBeenCalled();
  });

  it("creates a GitHub issue for valid feedback", async () => {
    state.createFeedbackIssue.mockResolvedValue({
      html_url: "https://github.com/acme/gitinspect/issues/42",
      number: 42,
    });
    const { Route } = await import("@/routes/api/feedback");

    const response = await Route.options.server.handlers.POST({
      request: new Request("https://gitinspect.com/api/feedback", {
        body: JSON.stringify({
          diagnostics: {
            pathname: "/chat/session-1",
          },
          includeDiagnostics: true,
          message: "Need a better hint for the model picker",
          sentiment: "neutral",
          website: "",
        }),
        headers: {
          "content-type": "application/json",
          origin: "https://gitinspect.com",
          referer: "https://gitinspect.com/chat/session-1",
          "user-agent": "Mozilla/5.0",
        },
        method: "POST",
      }),
    });

    expect(response.status).toBe(201);
    expect(state.createFeedbackIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "gitinspect",
        token: "github-token",
        userAgent: "Mozilla/5.0",
      }),
    );
    await expect(response.json()).resolves.toEqual({
      issueNumber: 42,
      issueUrl: "https://github.com/acme/gitinspect/issues/42",
      ok: true,
    });
  });
});
