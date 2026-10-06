import { zstdDecompressSync } from "node:zlib";
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import { createProviderModels } from "@/agent/provider-models";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  proxy: { enabled: true, url: "https://proxy.test" },
}));
vi.mock("@/auth/resolve-api-key", () => ({ resolveProviderAuthForProvider: mocks.auth }));
vi.mock("@/proxy/settings", () => ({ getProxyConfig: async () => mocks.proxy }));

const context: Context = {
  systemPrompt: "Inspect repos",
  messages: [{ role: "user", content: "hello", timestamp: 1 }],
};
function sse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}
function jwt(claims: object) {
  const part = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  return `${part({ alg: "none" })}.${part(claims)}.signature`;
}
function credential(apiKey: string, isOAuth = true) {
  mocks.auth.mockImplementation(async (provider: string) => ({
    apiKey,
    isOAuth,
    provider,
    storedValue: apiKey,
  }));
}
function request(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  const headers = new Headers(init.headers);
  // Under Node, Pi AI compresses Codex requests; browsers send them as JSON.
  const body =
    headers.get("content-encoding") === "zstd"
      ? zstdDecompressSync(init.body as Uint8Array).toString()
      : String(init.body);
  return { url: decodeURIComponent(url), body: JSON.parse(body), headers };
}

describe("provider models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proxy = { enabled: true, url: "https://proxy.test" };
  });
  it("offers the catalog's models, including subscription-only ones", () => {
    const models = createProviderModels();
    expect(models.getModel("openai-codex", "gpt-5.4-nano")).toMatchObject({
      api: "openai-codex-responses",
    });
    expect(models.getModel("anthropic", "claude-sonnet-4-6")).toBeDefined();
    expect(models.getModel("fireworks-ai", "accounts/fireworks/models/kimi-k2p6")?.provider).toBe(
      "fireworks-ai",
    );
  });
  it("sends a ChatGPT subscription turn to the Codex endpoint through the proxy", async () => {
    const token = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "account-test" } });
    credential(token);
    const fetchMock = vi.fn(async () =>
      sse([
        { type: "response.output_item.added", item: { type: "message", id: "m1", content: [] } },
        { type: "response.content_part.added", part: { type: "output_text", text: "" } },
        { type: "response.output_text.delta", delta: "Hi" },
        {
          type: "response.output_item.done",
          item: { type: "message", id: "m1", content: [{ type: "output_text", text: "Hi" }] },
        },
        {
          type: "response.completed",
          response: {
            id: "resp_1",
            status: "completed",
            usage: { input_tokens: 5, output_tokens: 2 },
          },
        },
      ]),
    );
    const models = createProviderModels();
    const message = await models.completeSimple(
      models.getModel("openai-codex", "gpt-5.4")!,
      context,
      {
        fetch: fetchMock as never,
        transport: "sse",
      },
    );
    expect(message).toMatchObject({ stopReason: "stop", content: [{ type: "text", text: "Hi" }] });
    const { url, body, headers } = request(fetchMock);
    expect(url).toBe("https://proxy.test/?url=https://chatgpt.com/backend-api/codex/responses");
    expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("chatgpt-account-id")).toBe("account-test");
    expect(body).toMatchObject({
      model: "gpt-5.4",
      instructions: "Inspect repos",
      store: false,
      stream: true,
    });
  });
  it("calls providers directly when their credential needs no proxy", async () => {
    credential("sk-ant-api-key", false);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    const models = createProviderModels();
    await models.completeSimple(models.getModel("anthropic", "claude-sonnet-4-6")!, context, {
      fetch: fetchMock as never,
      maxRetries: 0,
    });
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(
      /^https:\/\/api\.anthropic\.com\/v1\/messages/,
    );
  });
  it("reports a provider without stored credentials as a failed answer", async () => {
    mocks.auth.mockResolvedValue(undefined);
    const models = createProviderModels();
    const message = await models.completeSimple(models.getModel("openai", "gpt-5.4")!, context);
    expect(message.stopReason).toBe("error");
  });
  it("speaks the Cloud Code Assist envelope for Gemini CLI subscriptions", async () => {
    credential(JSON.stringify({ token: "google-token", projectId: "project-1" }));
    mocks.proxy = { enabled: false, url: "" };
    const fetchMock = vi.fn(async () =>
      sse([
        { response: { candidates: [{ content: { parts: [{ text: "Plan", thought: true }] } }] } },
        { response: { candidates: [{ content: { parts: [{ text: "Hel" }, { text: "lo" }] } }] } },
        {
          response: {
            candidates: [
              {
                content: { parts: [{ functionCall: { name: "read", args: { path: "a.ts" } } }] },
                finishReason: "STOP",
              },
            ],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 },
          },
        },
      ]),
    );
    const models = createProviderModels();
    const message = await models.completeSimple(
      models.getModel("google-gemini-cli", "gemini-2.5-pro")!,
      context,
      { fetch: fetchMock as never, reasoning: "low" },
    );
    expect(message).toMatchObject({
      stopReason: "toolUse",
      usage: { input: 10, output: 4, totalTokens: 14 },
      content: [
        { type: "thinking", thinking: "Plan" },
        { type: "text", text: "Hello" },
        { type: "toolCall", name: "read", arguments: { path: "a.ts" } },
      ],
    });
    const { url, body, headers } = request(fetchMock);
    expect(url).toBe(
      "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
    );
    expect(headers.get("Authorization")).toBe("Bearer google-token");
    expect(body).toMatchObject({
      model: "gemini-2.5-pro",
      project: "project-1",
      request: {
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        systemInstruction: { parts: [{ text: "Inspect repos" }] },
        generationConfig: { thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 } },
      },
    });
  });
});
