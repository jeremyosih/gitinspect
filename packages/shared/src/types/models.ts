export type KnownProvider =
  | "amazon-bedrock"
  | "anthropic"
  | "google"
  | "google-gemini-cli"
  | "google-antigravity"
  | "google-vertex"
  | "openai"
  | "azure-openai-responses"
  | "openai-codex"
  | "github-copilot"
  | "xai"
  | "groq"
  | "cerebras"
  | "openrouter"
  | "vercel-ai-gateway"
  | "zai"
  | "mistral"
  | "minimax"
  | "minimax-cn"
  | "huggingface"
  | "opencode"
  | "opencode-go"
  | "kimi-coding";
export type ProviderId = KnownProvider | "fireworks-ai";
// Legacy free group remains readable for old local transcripts; it has no hosted credential.
export type ProviderGroupId = ProviderId | "fireworks-free";
export interface ProviderGroupDefinition {
  canonicalProvider: ProviderId;
  description: string;
  id: ProviderGroupId;
  label: string;
}
export type ApiType = string;
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type ModelInput = "image" | "text";
export interface UsageCost {
  cacheRead: number;
  cacheWrite: number;
  input: number;
  output: number;
  total: number;
}
export interface Usage {
  cacheRead: number;
  cacheWrite: number;
  input: number;
  output: number;
  totalTokens: number;
  cost: UsageCost;
}
export interface ModelDefinition {
  id: string;
  name: string;
  api: ApiType;
  provider: ProviderId;
  baseUrl: string;
  reasoning: boolean;
  input: ModelInput[];
  cost: Omit<UsageCost, "total">;
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  free?: boolean;
}
export function createEmptyUsage(): Usage {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    input: 0,
    output: 0,
    totalTokens: 0,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  };
}
