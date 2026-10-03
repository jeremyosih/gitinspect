// Model metadata snapshot from pi-ai 0.62.0 (MIT). See THIRD_PARTY_NOTICES.md.
// The runtime uses provider SDKs; this data preserves existing selections.
import registry from "./registry.json";
import type { KnownProvider, ModelDefinition } from "../types/models";
const providers = registry as unknown as Record<KnownProvider, ModelDefinition[]>;
export function getProviders(): KnownProvider[] {
  return Object.keys(providers) as KnownProvider[];
}
export function getModels(provider: string): ModelDefinition[] {
  return providers[provider as KnownProvider] ?? [];
}
export function getModel(provider: string, id: string): ModelDefinition | undefined {
  return getModels(provider).find((model) => model.id === id);
}
