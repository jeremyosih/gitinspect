import { describe, expect, it } from "vitest";
import { feedbackSchema, normalizeFeedbackPayload } from "@gitinspect/shared/feedback";

describe("feedback schema", () => {
  it("accepts bounded payloads and trims message fields", () => {
    const parsed = feedbackSchema.parse({
      diagnostics: {
        language: "en-US",
        pathname: "/chat/session-1",
      },
      includeDiagnostics: true,
      message: "   Great UX improvements   ",
      sentiment: "happy",
      website: "",
    });

    expect(parsed.message).toBe("Great UX improvements");
  });

  it("rejects empty feedback after trimming", () => {
    const result = feedbackSchema.safeParse({
      includeDiagnostics: false,
      message: "   ",
      sentiment: "neutral",
      website: "",
    });

    expect(result.success).toBe(false);
  });

  it("drops diagnostics when the client did not opt in", () => {
    const parsed = feedbackSchema.parse({
      diagnostics: {
        pathname: "/chat/session-1",
      },
      includeDiagnostics: false,
      message: "Needs more clarity around models",
      sentiment: "neutral",
      website: "",
    });

    expect(normalizeFeedbackPayload(parsed).diagnostics).toBeUndefined();
  });
});
