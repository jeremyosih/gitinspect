import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModelV4, LanguageModelV4CallOptions } from "@ai-sdk/provider";
import type { ModelDefinition, ThinkingLevel } from "../types/models";
import type { ResolvedProviderAuth } from "../auth/resolve-api-key";
import { parseOAuthCredentials } from "../auth/oauth-types";
import { getProxyConfig } from "../proxy/settings";
import { buildProxiedUrl } from "../proxy/url";
import { shouldUseProxyForProvider } from "./provider-proxy";

export interface ProviderTransportOptions {
  model: ModelDefinition;
  auth: ResolvedProviderAuth;
  sessionId: string;
  thinkingLevel: ThinkingLevel;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

/** Subscription inference uses the ChatGPT account, not an OpenAI API key. */
export function codexRequestBody(body: Record<string, unknown>): Record<string, unknown> {
  const input = Array.isArray(body.input) ? body.input : [];
  const system = input.filter((item) => item && ["system", "developer"].includes(item.role));
  const instructions = system
    .map((item) =>
      typeof item.content === "string"
        ? item.content
        : Array.isArray(item.content)
          ? item.content.map((part: { text?: string }) => part.text ?? "").join("\n")
          : "",
    )
    .filter(Boolean)
    .join("\n\n");
  const next = {
    ...body,
    input: input.filter((item) => !system.includes(item)),
    instructions: instructions || body.instructions || "You are a repository inspection assistant.",
    store: false,
    stream: true,
  };
  for (const key of [
    "max_output_tokens",
    "temperature",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "previous_response_id",
  ])
    delete (next as Record<string, unknown>)[key];
  return next;
}

// Cloud Code Assist wraps Gemini's standard SSE payload in {response: ...}.
function unwrapGeminiStream(response: Response): Response {
  if (!response.ok || !response.body) return response;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return new Response(
    response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true });
          let newline;
          while ((newline = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            if (line.startsWith("data: ")) {
              try {
                const value = JSON.parse(line.slice(6));
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(value.response ?? value)}\n`),
                );
              } catch {
                controller.enqueue(encoder.encode(line + "\n"));
              }
            } else controller.enqueue(encoder.encode(line + "\n"));
          }
        },
        flush(controller) {
          if (buffer) controller.enqueue(encoder.encode(buffer));
        },
      }),
    ),
    { status: response.status, headers: response.headers },
  );
}

export async function createProviderModel(
  options: ProviderTransportOptions,
): Promise<LanguageModelV4> {
  const { model, auth, sessionId } = options;
  const nativeFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const proxy = await getProxyConfig();
  const credentials = auth.isOAuth ? parseOAuthCredentials(auth.storedValue) : undefined;
  const headers: Record<string, string> = { ...model.headers };
  if (model.provider === "openai-codex") {
    if (!credentials?.accountId)
      throw new Error("Sign in with ChatGPT before using a subscription model.");
    headers["ChatGPT-Account-Id"] = credentials.accountId;
    headers.originator = "gitinspect";
    headers["OpenAI-Beta"] = "responses=experimental";
  }
  if (model.provider === "github-copilot")
    Object.assign(headers, {
      "Editor-Version": "vscode/1.96.2",
      "Editor-Plugin-Version": "copilot/1.0.0",
      "Copilot-Integration-Id": "vscode-chat",
      "X-Initiator": "user",
    });
  if (model.api === "anthropic-messages" && auth.isOAuth)
    Object.assign(headers, {
      Authorization: `Bearer ${auth.apiKey}`,
      "anthropic-beta": "oauth-2025-04-20,interleaved-thinking-2025-05-14",
      "anthropic-dangerous-direct-browser-access": "true",
    });
  const requestFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async (
    input,
    init,
  ) => {
    let url = String(input instanceof Request ? input.url : input);
    let body = init?.body;
    const requestHeaders = new Headers(init?.headers);
    requestHeaders.set("x-gitinspect-session-id", sessionId);
    if (model.provider === "openai-codex" && typeof body === "string")
      body = JSON.stringify(codexRequestBody(JSON.parse(body)));
    if (model.api === "anthropic-messages" && auth.isOAuth) {
      requestHeaders.delete("x-api-key");
      requestHeaders.set("Authorization", `Bearer ${auth.apiKey}`);
      if (typeof body === "string") {
        const value = JSON.parse(body);
        value.system = [
          { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
          ...(Array.isArray(value.system) ? value.system : []),
        ];
        body = JSON.stringify(value);
      }
    }
    if (model.provider === "google-gemini-cli" && credentials) {
      const value = typeof body === "string" ? JSON.parse(body) : {};
      url = "https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
      body = JSON.stringify({ model: model.id, project: credentials.projectId, request: value });
      requestHeaders.delete("x-goog-api-key");
      requestHeaders.set("Authorization", `Bearer ${credentials.access}`);
    }
    if (proxy.enabled && shouldUseProxyForProvider(model.provider, auth.apiKey))
      url = buildProxiedUrl(proxy.url, url);
    const response = await nativeFetch(url, { ...init, headers: requestHeaders, body });
    return model.provider === "google-gemini-cli" ? unwrapGeminiStream(response) : response;
  };
  const baseURL = (
    model.provider === "openai-codex" ? "https://chatgpt.com/backend-api/codex" : model.baseUrl
  ).replace(/\/responses\/?$/, "");
  if (model.api === "anthropic-messages")
    return createAnthropic({
      apiKey: auth.apiKey,
      baseURL,
      headers,
      fetch: requestFetch as typeof globalThis.fetch,
    })(model.id);
  if (model.api === "google-generative-ai" || model.provider === "google-gemini-cli")
    return createGoogleGenerativeAI({
      apiKey: auth.apiKey,
      baseURL: model.provider === "google-gemini-cli" ? undefined : baseURL,
      headers,
      fetch: requestFetch as typeof globalThis.fetch,
    })(model.id);
  if (model.api.includes("responses"))
    return createOpenAI({
      apiKey: auth.apiKey,
      baseURL,
      headers,
      fetch: requestFetch as typeof globalThis.fetch,
    }).responses(model.id);
  return createOpenAICompatible({
    name: model.provider,
    apiKey: auth.apiKey,
    baseURL,
    headers,
    fetch: requestFetch as typeof globalThis.fetch,
  }).chatModel(model.id);
}

/** libfx speaks AI SDK v4 over its host fetch boundary. No gateway account is needed. */
export function createFxFetch(
  model: LanguageModelV4,
  definition: ModelDefinition,
  thinkingLevel: ThinkingLevel,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname.endsWith("/models"))
      return Response.json({
        data: [
          {
            id: `${definition.provider}/${definition.id}`,
            name: definition.name,
            type: "language",
            context_window: definition.contextWindow,
            max_tokens: definition.maxTokens,
            tags: definition.reasoning ? ["reasoning", "tool-use"] : ["tool-use"],
          },
        ],
      });
    if (url.pathname !== "/v4/ai/language-model" || init?.method !== "POST")
      throw new Error(`Unexpected fx transport endpoint: ${url.pathname}`);
    const options = (await new Response(init.body).json()) as LanguageModelV4CallOptions;
    options.abortSignal = init.signal ?? undefined;
    options.maxOutputTokens = definition.maxTokens;
    const effort =
      thinkingLevel === "off"
        ? undefined
        : thinkingLevel === "minimal"
          ? "low"
          : thinkingLevel === "xhigh"
            ? "high"
            : thinkingLevel;
    options.providerOptions = {
      ...options.providerOptions,
      openai: { ...options.providerOptions?.openai, store: false, reasoningEffort: effort },
      anthropic: {
        ...options.providerOptions?.anthropic,
        ...(effort
          ? {
              thinking: {
                type: "enabled",
                budgetTokens: effort === "high" ? 8192 : effort === "medium" ? 4096 : 1024,
              },
            }
          : {}),
      },
    };
    try {
      const result = await model.doStream(options);
      const encoder = new TextEncoder();
      const reader = result.stream.getReader();
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              reader.releaseLock();
            } else {
              // SDK errors are Error instances, whose message JSON would otherwise discard.
              const part = JSON.stringify(next.value, (_key, value) =>
                value instanceof Error ? { message: value.message } : value,
              );
              controller.enqueue(encoder.encode(`data: ${part}\n\n`));
            }
          } catch (error) {
            controller.error(error);
          }
        },
        async cancel(reason) {
          await reader.cancel(reason);
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      const status =
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        typeof error.statusCode === "number" &&
        error.statusCode >= 400 &&
        error.statusCode <= 599
          ? error.statusCode
          : 502;
      return Response.json(
        { error: { message: error instanceof Error ? error.message : String(error) } },
        { status },
      );
    }
  };
}
