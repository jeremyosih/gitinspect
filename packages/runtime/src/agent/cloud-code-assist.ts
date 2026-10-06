import {
  calculateCost,
  clampThinkingLevel,
  collapseSystemMessages,
  createAssistantMessageEventStream,
  getCurrentTools,
  getInitialSystemMessage,
  getSystemMessageText,
} from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Model,
  ProviderStreams,
  SimpleStreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
  TranscriptContext,
} from "@earendil-works/pi-ai";

/**
 * Gemini CLI subscriptions answer on Google's Cloud Code Assist endpoint, which wraps the
 * Gemini request and each streamed response. Pi AI 1.0 ships no adapter for it, so this one
 * reuses Pi AI's Gemini message and tool conversion and speaks the envelope itself.
 */
const ENDPOINT = "/v1internal:streamGenerateContent?alt=sse";
const HEADERS = {
  "Client-Metadata": JSON.stringify({
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  }),
  "X-Goog-Api-Client": "gl-node/22.17.0",
};
const THINKING_BUDGETS = { minimal: 128, low: 2048, medium: 8192, high: 24576 };

type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name?: string; args?: ToolCall["arguments"] };
};
type GeminiChunk = {
  responseId?: string;
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
};
type GeminiModel = Model<"google-generative-ai">;

/** The stored credential is `{ token, projectId }`: the OAuth access token and its project. */
function parseCredential(apiKey: string | undefined): { token: string; projectId: string } {
  try {
    const value = JSON.parse(apiKey ?? "") as { token?: unknown; projectId?: unknown };

    if (typeof value.token === "string" && typeof value.projectId === "string")
      return { token: value.token, projectId: value.projectId };
  } catch {
    // Reported below with the sign-in hint.
  }

  throw new Error("Sign in with Google before using a Gemini CLI model.");
}

async function buildRequest(
  model: Model<Api>,
  context: TranscriptContext,
  options: SimpleStreamOptions | undefined,
  projectId: string,
) {
  const google = await import("@earendil-works/pi-ai/api/google-shared");
  // SAFETY: Cloud Code Assist takes Gemini's own request body; only the endpoint envelope differs.
  const gemini = model as GeminiModel;
  const system = getInitialSystemMessage(context.messages);
  const tools = getCurrentTools(context.messages);
  const generationConfig: Record<string, unknown> = {};
  const level = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : "off";

  if (options?.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;

  if (model.reasoning && level !== "off") {
    const resolved = google.resolveGoogleThinkingLevel(gemini, level);

    generationConfig.thinkingConfig = google.usesGoogleThinkingLevel(gemini)
      ? { includeThoughts: true, thinkingLevel: google.toGoogleThinkingLevel(resolved) }
      : { includeThoughts: true, thinkingBudget: THINKING_BUDGETS[resolved] };
  } else if (model.reasoning) {
    generationConfig.thinkingConfig = google.getDisabledGoogleThinkingConfig(gemini);
  }

  return {
    model: model.id,
    project: projectId,
    request: {
      contents: google.convertMessages(gemini, context),
      ...(system ? { systemInstruction: { parts: [{ text: getSystemMessageText(system) }] } } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
      ...(tools.length > 0 ? { tools: google.convertTools(tools) } : {}),
    },
    requestId: `gitinspect-${crypto.randomUUID()}`,
    userAgent: "gitinspect",
    mapStopReason: google.mapStopReasonString,
  };
}

async function* readChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<GeminiChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();

    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : (lines.pop() ?? "");

    for (const line of lines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : "";

      if (data && data !== "[DONE]") {
        const parsed = JSON.parse(data) as { response?: GeminiChunk } & GeminiChunk;

        yield parsed.response ?? parsed;
      }
    }

    if (done) return;
  }
}

function stream(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const events = createAssistantMessageEventStream();
  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  const index = () => output.content.length - 1;
  let block: TextContent | ThinkingContent | undefined;
  let finished = false;

  const endBlock = () => {
    if (block?.type === "text")
      events.push({
        type: "text_end",
        contentIndex: index(),
        content: block.text,
        partial: output,
      });
    else if (block)
      events.push({
        type: "thinking_end",
        contentIndex: index(),
        content: block.thinking,
        partial: output,
      });
    block = undefined;
  };

  const appendText = (part: GeminiPart & { text: string }) => {
    const type = part.thought === true ? "thinking" : "text";

    if (block?.type !== type) {
      endBlock();
      block = type === "text" ? { type, text: "" } : { type, thinking: "" };
      output.content.push(block);
      events.push({ type: `${type}_start`, contentIndex: index(), partial: output });
    }

    if (block.type === "text") {
      block.text += part.text;
      block.textSignature = part.thoughtSignature ?? block.textSignature;
    } else {
      block.thinking += part.text;
      block.thinkingSignature = part.thoughtSignature ?? block.thinkingSignature;
    }

    events.push({
      type: `${type}_delta`,
      contentIndex: index(),
      delta: part.text,
      partial: output,
    });
  };

  const appendToolCall = (part: GeminiPart & Required<Pick<GeminiPart, "functionCall">>) => {
    endBlock();
    const call = part.functionCall;
    const taken = output.content.some((item) => item.type === "toolCall" && item.id === call.id);
    const toolCall: ToolCall = {
      type: "toolCall",
      id: call.id && !taken ? call.id : `${call.name ?? "tool"}_${crypto.randomUUID()}`,
      name: call.name ?? "",
      arguments: call.args ?? {},
      ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
    };

    output.content.push(toolCall);
    events.push({ type: "toolcall_start", contentIndex: index(), partial: output });
    events.push({
      type: "toolcall_delta",
      contentIndex: index(),
      delta: JSON.stringify(toolCall.arguments),
      partial: output,
    });
    events.push({ type: "toolcall_end", contentIndex: index(), toolCall, partial: output });
  };

  const run = async () => {
    const credential = parseCredential(options?.apiKey);
    const { mapStopReason, ...body } = await buildRequest(
      model,
      collapseSystemMessages(context),
      options,
      credential.projectId,
    );
    const response = await (options?.fetch ?? globalThis.fetch)(`${model.baseUrl}${ENDPOINT}`, {
      method: "POST",
      headers: {
        ...HEADERS,
        ...model.headers,
        Accept: "text/event-stream",
        Authorization: `Bearer ${credential.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });

    if (!response.ok || !response.body)
      throw new Error(
        `Cloud Code Assist request failed (${response.status}): ${await response.text()}`,
      );

    events.push({ type: "start", partial: output });

    for await (const chunk of readChunks(response.body)) {
      const candidate = chunk.candidates?.[0];

      output.responseId ||= chunk.responseId;

      for (const part of candidate?.content?.parts ?? []) {
        if (part.text !== undefined) appendText({ ...part, text: part.text });

        if (part.functionCall) appendToolCall({ ...part, functionCall: part.functionCall });
      }

      if (candidate?.finishReason) {
        finished = true;
        output.stopReason = mapStopReason(candidate.finishReason);
      }

      if (chunk.usageMetadata) {
        const usage = chunk.usageMetadata;
        const cacheRead = usage.cachedContentTokenCount ?? 0;

        output.usage = {
          ...output.usage,
          input: (usage.promptTokenCount ?? 0) - cacheRead,
          output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
          cacheRead,
          totalTokens: usage.totalTokenCount ?? 0,
        };
        calculateCost(model, output.usage);
      }
    }

    endBlock();

    if (!finished) throw new Error("Cloud Code Assist stream ended without a finish reason");

    if (output.stopReason === "error" || output.stopReason === "aborted")
      throw new Error("Cloud Code Assist stopped the response");

    if (output.content.some((item) => item.type === "toolCall")) output.stopReason = "toolUse";

    return output.stopReason === "length" || output.stopReason === "toolUse"
      ? output.stopReason
      : "stop";
  };

  run().then(
    (reason) => {
      events.push({ type: "done", reason, message: output });
      events.end();
    },
    (error: unknown) => {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      events.push({ type: "error", reason: output.stopReason, error: output });
      events.end();
    },
  );

  return events;
}

export function cloudCodeAssistApi(): ProviderStreams {
  return { stream, streamSimple: stream };
}
