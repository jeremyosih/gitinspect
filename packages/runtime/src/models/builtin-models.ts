import type { ModelDefinition } from "@gitinspect/runtime/types/models";

export const FIREWORKS_KIMI_K26_ID = "accounts/fireworks/models/kimi-k2p6" as const;

/** Fireworks Kimi K2.6 (OpenAI-compatible API). */
export const FIREWORKS_KIMI_K26: ModelDefinition = {
  api: "openai-completions",
  baseUrl: "https://api.fireworks.ai/inference/v1",
  contextWindow: 262_144,
  cost: {
    cacheRead: 0.1,
    cacheWrite: 0,
    input: 0.6,
    output: 3,
  },
  id: FIREWORKS_KIMI_K26_ID,
  input: ["text", "image"],
  maxTokens: 16_384,
  name: "Kimi K2.6",
  provider: "fireworks-ai",
  reasoning: false,
};
