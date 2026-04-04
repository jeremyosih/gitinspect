import { describe, expect, it } from "vitest";
import {
  assertAllowedFeedbackRequest,
  isAllowedFeedbackOrigin,
  isAllowedFeedbackReferer,
} from "@/lib/feedback.server";

const allowedOrigin = "https://gitinspect.com";

function createRequest(headers: HeadersInit) {
  return new Request("https://gitinspect.com/api/feedback", {
    body: JSON.stringify({ ok: true }),
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    method: "POST",
  });
}

describe("feedback route guards", () => {
  it("allows matching origin and referer", () => {
    const request = createRequest({
      origin: allowedOrigin,
      referer: `${allowedOrigin}/chat/session-1`,
    });

    expect(isAllowedFeedbackOrigin(request, allowedOrigin)).toBe(true);
    expect(isAllowedFeedbackReferer(request, allowedOrigin)).toBe(true);
    expect(assertAllowedFeedbackRequest(request, allowedOrigin)).toBeNull();
  });

  it("rejects mismatched origin", async () => {
    const request = createRequest({
      origin: "https://evil.example",
      referer: `${allowedOrigin}/chat/session-1`,
    });
    const response = assertAllowedFeedbackRequest(request, allowedOrigin);

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("rejects non-json payloads", async () => {
    const request = new Request("https://gitinspect.com/api/feedback", {
      body: "hello",
      headers: {
        origin: allowedOrigin,
        referer: `${allowedOrigin}/chat/session-1`,
      },
      method: "POST",
    });
    const response = assertAllowedFeedbackRequest(request, allowedOrigin);

    expect(response?.status).toBe(415);
    await expect(response?.json()).resolves.toEqual({ error: "Expected application/json" });
  });
});
