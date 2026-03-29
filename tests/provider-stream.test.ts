import { Type } from "@sinclair/typebox"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai"
import type * as PiAi from "@mariozechner/pi-ai"
import type { AssistantMessage as PiAssistantMessage } from "@mariozechner/pi-ai"
import { getModel } from "@/models/catalog"
import { createEmptyUsage } from "@/types/models"
import { buildProxiedUrl } from "@/proxy/url"

const {
  getProxyConfig,
  resolveProviderAuthForProvider,
  streamSimple,
} = vi.hoisted(() => ({
  getProxyConfig: vi.fn(),
  resolveProviderAuthForProvider: vi.fn(),
  streamSimple: vi.fn(),
}))

vi.mock("@/auth/resolve-api-key", () => ({
  resolveProviderAuthForProvider,
}))

vi.mock("@/proxy/settings", () => ({
  getProxyConfig,
}))

vi.mock("@mariozechner/pi-ai", async () => {
  const actual = await vi.importActual<typeof PiAi>("@mariozechner/pi-ai")

  return {
    ...actual,
    streamSimple,
  }
})

function createAssistant(
  model: {
    api: string
    id: string
    provider: string
  },
  overrides: Partial<PiAssistantMessage> = {}
): PiAssistantMessage {
  return {
    api: model.api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp: 2,
    usage: createEmptyUsage(),
    ...overrides,
  }
}

function createMockStream(
  emit: (stream: ReturnType<typeof createAssistantMessageEventStream>) => void
) {
  const stream = createAssistantMessageEventStream()

  queueMicrotask(() => {
    emit(stream)
  })

  return stream
}

describe("provider stream", () => {
  beforeEach(() => {
    resolveProviderAuthForProvider.mockReset()
    getProxyConfig.mockReset()
    streamSimple.mockReset()
  })

  it("delegates codex streaming to pi-ai and proxies the model baseUrl", async () => {
    resolveProviderAuthForProvider.mockResolvedValue({
      apiKey: "api-key",
      isOAuth: true,
      provider: "openai-codex",
      storedValue: '{"providerId":"openai-codex"}',
    })
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    })
    streamSimple.mockImplementation((model) =>
      createMockStream((stream) => {
        const partial = createAssistant(model, {
          content: [{ text: "", type: "text" }],
        })
        const finalMessage = createAssistant(model, {
          content: [{ text: "Hello", type: "text" }],
        })

        stream.push({ partial, type: "start" })
        stream.push({ contentIndex: 0, partial, type: "text_start" })
        stream.push({
          contentIndex: 0,
          delta: "Hello",
          partial: {
            ...partial,
            content: [{ text: "Hello", type: "text" }],
          },
          type: "text_delta",
        })
        stream.push({
          content: "Hello",
          contentIndex: 0,
          partial: finalMessage,
          type: "text_end",
        })
        stream.push({
          message: finalMessage,
          reason: "stop",
          type: "done",
        })
        stream.end(finalMessage)
      })
    )

    const { streamChat } = await import("@/agent/provider-stream")
    const model = getModel("openai-codex", "gpt-5.1-codex-mini")
    let text = ""
    const result = await streamChat({
      messages: [],
      model: "gpt-5.1-codex-mini",
      onTextDelta(delta) {
        text += delta
      },
      provider: "openai-codex",
      sessionId: "session-1",
      signal: new AbortController().signal,
      thinkingLevel: "medium",
      tools: [],
    })

    expect(streamSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: buildProxiedUrl("https://proxy.example/proxy", model.baseUrl),
        id: model.id,
      }),
      expect.objectContaining({
        messages: [],
        systemPrompt: expect.any(String),
      }),
      expect.objectContaining({
        apiKey: "api-key",
        maxTokens: model.maxTokens,
        reasoning: "medium",
        sessionId: "session-1",
      })
    )
    expect(text).toBe("Hello")
    expect(result.assistantMessage.content).toEqual([
      { text: "Hello", type: "text" },
    ])
    expect(result.assistantMessage.id).toBeTruthy()
  })

  it("keeps google gemini requests direct while still delegating to pi-ai", async () => {
    resolveProviderAuthForProvider.mockResolvedValue({
      apiKey: JSON.stringify({
        projectId: "project-1",
        token: "google-access",
      }),
      isOAuth: true,
      provider: "google-gemini-cli",
      storedValue: '{"providerId":"google-gemini-cli"}',
    })
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    })
    streamSimple.mockImplementation((model) =>
      createMockStream((stream) => {
        const message = createAssistant(model, {
          content: [{ text: "Gemini", type: "text" }],
        })

        stream.push({ partial: message, type: "start" })
        stream.push({
          message,
          reason: "stop",
          type: "done",
        })
        stream.end(message)
      })
    )

    const { streamChat } = await import("@/agent/provider-stream")
    const model = getModel("google-gemini-cli", "gemini-2.5-pro")
    const result = await streamChat({
      messages: [],
      model: "gemini-2.5-pro",
      onTextDelta() {},
      provider: "google-gemini-cli",
      sessionId: "session-4",
      signal: new AbortController().signal,
      thinkingLevel: "medium",
      tools: [],
    })

    expect(streamSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: model.baseUrl,
        id: model.id,
      }),
      expect.any(Object),
      expect.objectContaining({
        apiKey: JSON.stringify({
          projectId: "project-1",
          token: "google-access",
        }),
      })
    )
    expect(result.assistantMessage.content).toEqual([
      { text: "Gemini", type: "text" },
    ])
  })

  it("throws when the delegated stream ends with an error event", async () => {
    resolveProviderAuthForProvider.mockResolvedValue({
      apiKey: "api-key",
      isOAuth: false,
      provider: "fireworks-ai",
      storedValue: "api-key",
    })
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    })
    streamSimple.mockImplementation((model) =>
      createMockStream((stream) => {
        const partial = createAssistant(model, {
          content: [{ text: "Partial", type: "text" }],
        })
        const error = createAssistant(model, {
          content: [{ text: "Partial", type: "text" }],
          errorMessage: "Boom",
          stopReason: "error",
        })

        stream.push({ partial, type: "start" })
        stream.push({
          contentIndex: 0,
          delta: "Partial",
          partial,
          type: "text_delta",
        })
        stream.push({
          error,
          reason: "error",
          type: "error",
        })
        stream.end(error)
      })
    )

    const { streamChat } = await import("@/agent/provider-stream")
    const deltas: Array<string> = []

    await expect(
      streamChat({
        messages: [],
        model: "accounts/fireworks/routers/kimi-k2p5-turbo",
        onTextDelta(delta) {
          deltas.push(delta)
        },
        provider: "fireworks-ai",
        providerGroup: "fireworks-free",
        sessionId: "session-error",
        signal: new AbortController().signal,
        thinkingLevel: "medium",
        tools: [],
      })
    ).rejects.toThrow("Boom")

    expect(deltas).toEqual(["Partial"])
  })

  it("preserves pi-ai tool call events for agent mode and attaches app ids", async () => {
    getProxyConfig.mockResolvedValue({
      enabled: false,
      url: "https://proxy.example/proxy",
    })
    streamSimple.mockImplementation((model) =>
      createMockStream((stream) => {
        const partial = createAssistant(model, {
          content: [
            {
              arguments: { path: "README.md" },
              id: "call_123",
              name: "read",
              type: "toolCall",
            },
          ],
          stopReason: "toolUse",
        })
        const finalMessage = createAssistant(model, {
          content: [
            {
              arguments: { path: "README.md" },
              id: "call_123",
              name: "read",
              type: "toolCall",
            },
          ],
          stopReason: "toolUse",
        })

        stream.push({ partial, type: "start" })
        stream.push({
          contentIndex: 0,
          partial,
          type: "toolcall_start",
        })
        stream.push({
          contentIndex: 0,
          delta: '{"path":"README.md"}',
          partial,
          type: "toolcall_delta",
        })
        stream.push({
          contentIndex: 0,
          partial,
          toolCall: {
            arguments: { path: "README.md" },
            id: "call_123",
            name: "read",
            type: "toolCall",
          },
          type: "toolcall_end",
        })
        stream.push({
          message: finalMessage,
          reason: "toolUse",
          type: "done",
        })
        stream.end(finalMessage)
      })
    )

    const { streamChatWithPiAgent } = await import("@/agent/provider-stream")
    const model = getModel("opencode", "gpt-5-nano")
    const eventStream = await streamChatWithPiAgent(
      model,
      {
        messages: [],
        systemPrompt: "system",
        tools: [
          {
            description: "Read a file",
            name: "read",
            parameters: Type.Object({
              path: Type.String(),
            }),
          },
        ],
      },
      {
        apiKey: "sk-public-free-key",
        reasoning: "medium",
        sessionId: "session-tools",
      }
    )
    const events: Array<string> = []
    let startId: string | undefined
    let finalId: string | undefined

    for await (const event of eventStream) {
      events.push(event.type)

      if (event.type === "start") {
        startId =
          "id" in event.partial && typeof event.partial.id === "string"
            ? event.partial.id
            : undefined
      }

      if (event.type === "done") {
        finalId =
          "id" in event.message && typeof event.message.id === "string"
            ? event.message.id
            : undefined
      }
    }

    expect(streamSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "gpt-5-nano",
        provider: "opencode",
      }),
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            name: "read",
          }),
        ],
      }),
      expect.objectContaining({
        apiKey: "sk-public-free-key",
        reasoning: "medium",
        sessionId: "session-tools",
      })
    )
    expect(events).toEqual(
      expect.arrayContaining(["start", "toolcall_start", "toolcall_end", "done"])
    )
    expect(startId).toBeTruthy()
    expect(finalId).toBe(startId)
  })

  it("drops an empty trailing assistant placeholder before delegating to pi-ai", async () => {
    getProxyConfig.mockResolvedValue({
      enabled: false,
      url: "https://proxy.example/proxy",
    })
    streamSimple.mockImplementation((_model, context) =>
      createMockStream((stream) => {
        expect(context.messages).toEqual([
          {
            content: "hello",
            role: "user",
            timestamp: 1,
          },
        ])
        const message = createAssistant(_model, {
          content: [{ text: "Done", type: "text" }],
        })
        stream.push({ partial: message, type: "start" })
        stream.push({
          message,
          reason: "stop",
          type: "done",
        })
        stream.end(message)
      })
    )

    const { streamChatWithPiAgent } = await import("@/agent/provider-stream")
    const model = getModel("opencode", "gpt-5-nano")
    const eventStream = await streamChatWithPiAgent(
      model,
      {
        messages: [
          {
            content: "hello",
            role: "user",
            timestamp: 1,
          },
          createAssistant(model, {
            content: [{ text: "", type: "text" }],
          }),
        ],
        systemPrompt: "system",
        tools: [],
      },
      {
        apiKey: "sk-public-free-key",
        sessionId: "session-placeholder",
      }
    )

    await eventStream.result()
    expect(streamSimple).toHaveBeenCalledTimes(1)
  })
})
