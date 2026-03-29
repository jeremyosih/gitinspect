import type {
  Api,
  KnownProvider,
  Model,
  Usage as PiUsage,
} from "@mariozechner/pi-ai"

export type { KnownProvider }

/** Canonical provider id from the shared pi-ai registry plus app builtins. */
export type ProviderId = KnownProvider | "fireworks-ai"

export type ProviderGroupId = KnownProvider | "fireworks-free"

export interface ProviderGroupDefinition {
  canonicalProvider: ProviderId
  description: string
  id: ProviderGroupId
  label: string
}

export type ApiType = Api
export type { ThinkingLevel } from "@mariozechner/pi-agent-core"

export type ModelInput = "image" | "text"

export type Usage = PiUsage

export interface UsageCost {
  cacheRead: number
  cacheWrite: number
  input: number
  output: number
  total: number
}

export type ModelDefinition = Model<ApiType> & {
  free?: boolean
}

export function createEmptyUsage(): Usage {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      output: 0,
      total: 0,
    },
    input: 0,
    output: 0,
    totalTokens: 0,
  }
}
