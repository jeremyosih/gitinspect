import { beforeEach, describe, it, expect, vi } from "vitest";
import { createProviderModel, codexRequestBody, createFxFetch } from "@/agent/provider-stream";
import { getModel } from "@/models/catalog";
import { serializeOAuthCredentials } from "@/auth/oauth-types";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";

vi.mock("@/proxy/settings", () => ({
  getProxyConfig: async () => ({ enabled: true, url: "https://proxy.test" }),
}));
const options: LanguageModelV4CallOptions = {
  prompt: [
    { role: "system", content: "Inspect repos" },
    { role: "user", content: [{ type: "text", text: "hello" }] },
  ],
  maxOutputTokens: 1024,
};
function sse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("fx provider transport", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("routes ChatGPT OAuth through the subscription endpoint and account", async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        { type: "response.created", response: { id: "resp_1", created_at: 1, model: "gpt-5.4" } },
        {
          type: "response.completed",
          response: {
            id: "resp_1",
            status: "completed",
            output: [],
            usage: { input_tokens: 5, output_tokens: 2 },
          },
        },
      ]),
    );
    const storedValue = serializeOAuthCredentials({
      providerId: "openai-codex",
      access: "oauth-test-token",
      refresh: "refresh-test",
      expires: Date.now() + 600000,
      accountId: "account-test",
    });
    const model = await createProviderModel({
      model: getModel("openai-codex", "gpt-5.4"),
      auth: { apiKey: "oauth-test-token", provider: "openai-codex", isOAuth: true, storedValue },
      sessionId: "session-test",
      thinkingLevel: "medium",
      fetch: fetchMock,
    });
    const stream = await model.doStream(options);
    await stream.stream.pipeTo(new WritableStream());
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(decodeURIComponent(url)).toContain("https://chatgpt.com/backend-api/codex/responses");
    const headers = new Headers(request.headers);
    expect(headers.get("Authorization")).toBe("Bearer oauth-test-token");
    expect(headers.get("ChatGPT-Account-Id")).toBe("account-test");
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ store: false, stream: true, instructions: "Inspect repos" });
    expect(body.max_output_tokens).toBeUndefined();
    expect(body.input.every((item: any) => !["system", "developer"].includes(item.role))).toBe(
      true,
    );
  });
  it("rejects an API key masquerading as a ChatGPT subscription", async () => {
    await expect(
      createProviderModel({
        model: getModel("openai-codex", "gpt-5.4"),
        auth: {
          apiKey: "sk-test",
          provider: "openai-codex",
          isOAuth: false,
          storedValue: "sk-test",
        },
        sessionId: "test",
        thinkingLevel: "off",
      }),
    ).rejects.toThrow("Sign in with ChatGPT");
  });
  it("keeps direct Google keys on the Google API", async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        {
          candidates: [
            { content: { role: "model", parts: [{ text: "hello" }] }, finishReason: "STOP" },
          ],
        },
      ]),
    );
    const model = await createProviderModel({
      model: getModel("google", "gemini-2.5-pro"),
      auth: {
        apiKey: "google-test",
        provider: "google",
        isOAuth: false,
        storedValue: "google-test",
      },
      sessionId: "test",
      thinkingLevel: "off",
      fetch: fetchMock,
    });
    const response = await model.doStream(options);
    await response.stream.pipeTo(new WritableStream());
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("generativelanguage.googleapis.com");
  });
  it("bridges SDK stream parts to fx without a gateway request", async () => {
    const model = {
      doStream: vi.fn(async () => ({
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "text-delta", id: "a", delta: "hello" });
            c.close();
          },
        }),
      })),
    };
    const fetch = createFxFetch(model as any, getModel("openai", "gpt-5.4"), "off");
    const response = await fetch("https://ai-gateway.vercel.sh/v4/ai/language-model", {
      method: "POST",
      body: new TextEncoder().encode(JSON.stringify(options)),
    });
    expect(await response.text()).toContain('"delta":"hello"');
    expect(model.doStream).toHaveBeenCalledOnce();
  });
  it("normalizes the subscription request without removing tool input", () => {
    const body = codexRequestBody({
      input: [
        { role: "developer", content: "rules" },
        { type: "function_call_output", call_id: "call-1", output: "file" },
      ],
      max_output_tokens: 100,
      previous_response_id: "old",
    });
    expect(body).toMatchObject({
      instructions: "rules",
      store: false,
      input: [{ type: "function_call_output", call_id: "call-1", output: "file" }],
    });
    expect(body.previous_response_id).toBeUndefined();
  });
  it("preserves provider stream errors across the WASM JSON boundary", async () => {
    const model = {
      async doStream() {
        return {
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: "error", error: new Error("Subscription limit reached") });
              c.close();
            },
          }),
        };
      },
    };
    const fetch = createFxFetch(model as any, getModel("openai-codex", "gpt-5.4"), "off");
    const response = await fetch("https://ai-gateway.vercel.sh/v4/ai/language-model", {
      method: "POST",
      body: JSON.stringify(options),
    });
    expect(await response.text()).toContain('"error":{"message":"Subscription limit reached"}');
  });
});
