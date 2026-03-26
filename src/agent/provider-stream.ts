import type { StreamFn } from "@mariozechner/pi-agent-core"
import {
  createAssistantMessageEventStream,
  streamSimple,
  type Api,
  type AssistantMessage as PiAssistantMessage,
  type AssistantMessageEvent,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai"
import { SYSTEM_PROMPT } from "@/agent/system-prompt"
import { resolveProviderAuthForProvider } from "@/auth/resolve-api-key"
import { isOpencodeFreeMarker } from "@/auth/public-provider-fallbacks"
import { createId } from "@/lib/ids"
import { getModel } from "@/models/catalog"
import { getProxyConfig } from "@/proxy/settings"
import { buildProxiedUrl } from "@/proxy/url"
import { createEmptyUsage, type ModelDefinition } from "@/types/models"
import type { AssistantMessage, StopReason, ToolCall } from "@/types/chat"
import type {
  StreamChatParams,
  StreamChatResult,
} from "@/agent/runtime-types"

function createAssistantDraft(
  model: ModelDefinition,
  id: string,
  timestamp: number
): AssistantMessage {
  return {
    api: model.api,
    content: [],
    id,
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp,
    usage: createEmptyUsage(),
  }
}

function cloneToolCallArguments(
  argumentsValue: ToolCall["arguments"]
): ToolCall["arguments"] {
  return Object.fromEntries(Object.entries(argumentsValue))
}

function cloneContentBlock(
  block: PiAssistantMessage["content"][number]
): AssistantMessage["content"][number] {
  switch (block.type) {
    case "text":
      return { ...block }
    case "thinking":
      return { ...block }
    case "toolCall":
      return {
        ...block,
        arguments: cloneToolCallArguments(block.arguments),
      }
  }
}

function cloneUsage(usage: PiAssistantMessage["usage"]): AssistantMessage["usage"] {
  return {
    ...usage,
    cost: {
      ...usage.cost,
    },
  }
}

function syncAssistantMessage(
  target: AssistantMessage,
  source: PiAssistantMessage,
  id: string,
  fallbackTimestamp: number
): AssistantMessage {
  target.api = source.api
  target.content = source.content.map(cloneContentBlock)
  target.errorMessage = source.errorMessage
  target.id = id
  target.model = source.model
  target.provider = source.provider
  target.responseId = source.responseId
  target.role = "assistant"
  target.stopReason = source.stopReason
  target.timestamp = source.timestamp
  target.usage = cloneUsage(source.usage)

  if (target.timestamp === undefined) {
    target.timestamp = fallbackTimestamp
  }

  if (target.errorMessage === undefined) {
    delete target.errorMessage
  }

  if (target.responseId === undefined) {
    delete target.responseId
  }

  return target
}

function extractErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Request failed"
  }

  const parts: string[] = [error.message]
  let current: unknown = (error as Error & { cause?: unknown }).cause

  while (current instanceof Error) {
    if (current.message && !parts.includes(current.message)) {
      parts.push(current.message)
    }
    current = (current as Error & { cause?: unknown }).cause
  }

  return parts.join(" — ")
}

function formatConnectionDiagnostic(
  model: ModelDefinition,
  detail: string
): string {
  const target = model.baseUrl ?? "unknown endpoint"
  return `${detail} [${model.provider}/${model.id} → ${target}]`
}

function createStreamErrorMessage(
  model: ModelDefinition,
  id: string,
  timestamp: number,
  error: unknown,
  aborted: boolean
): AssistantMessage {
  const raw = extractErrorDetail(error)
  const errorMessage =
    raw === "Connection error."
      ? formatConnectionDiagnostic(model, raw)
      : raw

  return {
    ...createAssistantDraft(model, id, timestamp),
    errorMessage,
    stopReason: aborted ? "aborted" : "error",
  }
}

function toSuccessStopReason(
  reason: StopReason
): Extract<StopReason, "length" | "stop" | "toolUse"> {
  if (reason === "length") {
    return "length"
  }

  return reason === "toolUse" ? "toolUse" : "stop"
}

function normalizeReasoning(
  thinkingLevel: StreamChatParams["thinkingLevel"]
): SimpleStreamOptions["reasoning"] {
  return thinkingLevel === "off" ? undefined : thinkingLevel
}

function ensureAssistantMessageId(
  message: PiAssistantMessage | AssistantMessage
): AssistantMessage {
  if ("id" in message && typeof message.id === "string") {
    return message
  }

  return {
    ...message,
    id: createId(),
  }
}

function isEmptyAssistantPlaceholder(message: Message): boolean {
  if (message.role !== "assistant") {
    return false
  }

  return (
    message.content.length === 0 ||
    message.content.every((part) => {
      if (part.type === "text") {
        return part.text.length === 0
      }

      if (part.type === "thinking") {
        return part.thinking.length === 0
      }

      return false
    })
  )
}

function normalizeContext(context: Context): Context {
  const messages =
    context.messages.length > 0 &&
    isEmptyAssistantPlaceholder(context.messages[context.messages.length - 1]!)
      ? context.messages.slice(0, -1)
      : context.messages

  return {
    ...context,
    messages,
    systemPrompt: context.systemPrompt ?? SYSTEM_PROMPT,
  }
}

function shouldUseProxyForProvider(provider: string, apiKey: string): boolean {
  switch (provider.toLowerCase()) {
    case "anthropic":
      return apiKey.startsWith("sk-ant-oat") || apiKey.startsWith("{")
    case "openai":
    case "openai-codex":
    case "opencode":
    case "opencode-go":
      return true
    default:
      return false
  }
}

function applyProxyIfNeeded<TApi extends Api>(
  model: Model<TApi>,
  apiKey: string,
  proxyUrl?: string
): Model<TApi> {
  if (!proxyUrl || !model.baseUrl) {
    return model
  }

  if (!shouldUseProxyForProvider(model.provider, apiKey)) {
    return model
  }

  return {
    ...model,
    baseUrl: buildProxiedUrl(proxyUrl, model.baseUrl),
  }
}

export function createStreamFn(
  getProxyUrl: (apiKey: string) => Promise<string | undefined>
) {
  return async <TApi extends Api>(
    model: Model<TApi>,
    context: Context,
    options?: SimpleStreamOptions
  ) => {
    const apiKey = options?.apiKey

    if (!apiKey) {
      return streamSimple(model, context, options)
    }

    const proxyUrl = await getProxyUrl(apiKey)

    if (!proxyUrl) {
      return streamSimple(model, context, options)
    }

    const proxiedModel = applyProxyIfNeeded(model, apiKey, proxyUrl)
    return streamSimple(proxiedModel, context, options)
  }
}

const proxyAwareStreamSimple = createStreamFn(async (apiKey) => {
  if (isOpencodeFreeMarker(apiKey)) {
    return "/api/proxy"
  }

  const proxy = await getProxyConfig()
  return proxy.enabled ? proxy.url : undefined
})

function wrapAssistantMessageEventStream(
  model: ModelDefinition,
  upstream: ReturnType<typeof streamSimple>,
  assistantId: string,
  timestamp: number
) {
  const stream = createAssistantMessageEventStream()
  const partials = new WeakMap<object, AssistantMessage>()

  const decorateAssistant = (message: PiAssistantMessage): AssistantMessage => {
    const key = message as object
    const existing = partials.get(key)

    if (existing) {
      return syncAssistantMessage(existing, message, assistantId, timestamp)
    }

    const created = syncAssistantMessage(
      createAssistantDraft(model, assistantId, timestamp),
      message,
      assistantId,
      timestamp
    )
    partials.set(key, created)
    return created
  }

  const pushEvent = (event: AssistantMessageEvent): boolean => {
    switch (event.type) {
      case "start":
        stream.push({
          ...event,
          partial: decorateAssistant(event.partial),
        })
        return false
      case "text_start":
      case "text_delta":
      case "text_end":
      case "thinking_start":
      case "thinking_delta":
      case "thinking_end":
      case "toolcall_start":
      case "toolcall_delta":
        stream.push({
          ...event,
          partial: decorateAssistant(event.partial),
        })
        return false
      case "toolcall_end":
        stream.push({
          ...event,
          partial: decorateAssistant(event.partial),
          toolCall: {
            ...event.toolCall,
            arguments: cloneToolCallArguments(event.toolCall.arguments),
          },
        })
        return false
      case "done": {
        const message = decorateAssistant(event.message)
        stream.push({
          ...event,
          message,
          reason: toSuccessStopReason(message.stopReason),
        })
        stream.end(message)
        return true
      }
      case "error": {
        const error = decorateAssistant(event.error)
        if (error.errorMessage === "Connection error.") {
          error.errorMessage = formatConnectionDiagnostic(model, error.errorMessage)
        }
        console.error(
          `[provider-stream] Error from ${model.provider}/${model.id} (${model.baseUrl ?? "?"}):`,
          error.errorMessage
        )
        stream.push({
          ...event,
          error,
          reason: error.stopReason === "aborted" ? "aborted" : "error",
        })
        stream.end(error)
        return true
      }
    }
  }

  void (async () => {
    try {
      for await (const event of upstream) {
        if (pushEvent(event)) {
          return
        }
      }

      const message = decorateAssistant(await upstream.result())
      stream.push({
        message,
        reason: toSuccessStopReason(message.stopReason),
        type: "done",
      })
      stream.end(message)
    } catch (error) {
      console.error(
        `[provider-stream] Stream threw for ${model.provider}/${model.id} (${model.baseUrl ?? "?"}):`,
        error
      )
      const failure = createStreamErrorMessage(
        model,
        assistantId,
        timestamp,
        error,
        false
      )
      stream.push({
        error: failure,
        reason: "error",
        type: "error",
      })
      stream.end(failure)
    }
  })()

  return stream
}

async function createAppStream(
  model: ModelDefinition,
  context: Context,
  options?: SimpleStreamOptions,
  assistantId = createId(),
  timestamp = Date.now()
) {
  const upstream = await proxyAwareStreamSimple(model, normalizeContext(context), {
    ...options,
    maxTokens: options?.maxTokens ?? model.maxTokens,
  })

  return wrapAssistantMessageEventStream(
    model,
    upstream,
    assistantId,
    timestamp
  )
}

export async function streamChat(
  params: StreamChatParams
): Promise<StreamChatResult> {
  const model = getModel(params.provider, params.model)
  const auth =
    params.apiKey === undefined
      ? await resolveProviderAuthForProvider(params.provider, params.providerGroup)
      : {
          apiKey: params.apiKey,
          isOAuth: false,
          provider: params.provider,
          storedValue: params.apiKey,
        }

  if (!auth) {
    throw new Error(`No credentials stored for ${params.provider}`)
  }

  const stream = await createAppStream(
    model,
    {
      messages: params.messages,
      systemPrompt: SYSTEM_PROMPT,
      tools: params.tools,
    },
    {
      apiKey: auth.apiKey,
      reasoning: normalizeReasoning(params.thinkingLevel),
      sessionId: params.sessionId,
      signal: params.signal,
    },
    params.assistantId,
    params.assistantTimestamp
  )

  let assistantMessage: AssistantMessage | undefined

  for await (const event of stream) {
    if (event.type === "text_delta") {
      params.onTextDelta(event.delta)
      continue
    }

    if (event.type === "done") {
      assistantMessage = ensureAssistantMessageId(event.message)
      continue
    }

    if (event.type === "error") {
      throw new Error(event.error.errorMessage ?? "Request failed")
    }
  }

  if (!assistantMessage) {
    throw new Error("Stream ended without a final assistant message")
  }

  return { assistantMessage }
}

export const streamChatWithPiAgent: StreamFn = async (
  model,
  context,
  options
) => {
  const modelDefinition = getModel(
    model.provider as StreamChatParams["provider"],
    model.id
  )

  try {
    return await createAppStream(modelDefinition, context, options)
  } catch (error) {
    console.error(
      `[provider-stream] createAppStream failed for ${modelDefinition.provider}/${modelDefinition.id} (${modelDefinition.baseUrl ?? "?"}):`,
      error
    )
    const stream = createAssistantMessageEventStream()
    const failure = createStreamErrorMessage(
      modelDefinition,
      createId(),
      Date.now(),
      error,
      options?.signal?.aborted ?? false
    )

    queueMicrotask(() => {
      stream.push({
        error: failure,
        reason: failure.stopReason === "aborted" ? "aborted" : "error",
        type: "error",
      })
      stream.end(failure)
    })

    return stream
  }
}
