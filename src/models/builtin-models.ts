import type { ModelDefinition } from "@/types/models"

export const FIREWORKS_KIMI_K25_TURBO_ID =
  "accounts/fireworks/routers/kimi-k2p5-turbo" as const

/** Fireworks serverless Kimi K2.5 Turbo (OpenAI-compatible API). */
export const FIREWORKS_KIMI_K25_TURBO: ModelDefinition = {
  api: "openai-completions",
  baseUrl: "https://api.fireworks.ai/inference/v1",
  contextWindow: 262_144,
  cost: {
    cacheRead: 0.1,
    cacheWrite: 0,
    input: 0.6,
    output: 3,
  },
  id: FIREWORKS_KIMI_K25_TURBO_ID,
  input: ["text", "image"],
  maxTokens: 16_384,
  name: "Kimi K2.5 Turbo",
  provider: "fireworks-ai",
  reasoning: false,
}
