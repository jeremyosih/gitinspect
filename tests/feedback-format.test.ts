import { describe, expect, it } from "vitest";
import {
  buildFeedbackIssueBody,
  buildFeedbackIssueTitle,
  buildFeedbackLabels,
} from "@gitinspect/shared/feedback";

describe("feedback format helpers", () => {
  it("builds a bounded title with normalized whitespace", () => {
    expect(
      buildFeedbackIssueTitle({
        message: "  Love   the   repo  switcher speed   ",
        sentiment: "happy",
      }),
    ).toBe("Feedback: [happy] Love the repo switcher speed");
  });

  it("builds labels for negative feedback with diagnostics", () => {
    expect(
      buildFeedbackLabels({
        includeDiagnostics: true,
        message: "Sidebar collapsed while streaming",
        sentiment: "sad",
        website: "",
      }),
    ).toEqual(["feedback", "web", "negative", "has-diagnostics"]);
  });

  it("renders diagnostics details only when enabled", () => {
    expect(
      buildFeedbackIssueBody({
        payload: {
          diagnostics: {
            language: "en-US",
            model: "gpt-5-mini",
            pathname: "/chat/session-1",
            provider: "openai-codex",
            repo: {
              owner: "acme",
              path: "src/app.ts",
              ref: "main",
              repo: "demo",
            },
            theme: "dark",
            timezone: "America/Los_Angeles",
            viewport: {
              dpr: 2,
              height: 982,
              width: 1512,
            },
          },
          includeDiagnostics: true,
          message: "Sidebar collapsed while streaming",
          sentiment: "sad",
          website: "",
        },
        referer: "https://gitinspect.com/chat/session-1",
        submittedAt: "2026-04-02T18:20:00.000Z",
        userAgent: "Mozilla/5.0",
      }),
    ).toContain("- repo: acme/demo");

    expect(
      buildFeedbackIssueBody({
        payload: {
          includeDiagnostics: false,
          message: "App feels much faster after the refactor.",
          sentiment: "happy",
          website: "",
        },
        referer: "https://gitinspect.com/",
        submittedAt: "2026-04-02T18:20:00.000Z",
        userAgent: "Mozilla/5.0",
      }),
    ).toContain("- included: no");
  });
});
