import type { ProviderGroupId, ProviderId } from "../types/models";
export function getCanonicalProvider(group: ProviderGroupId): ProviderId {
  return group === "fireworks-free" || (group as string) === "opencode-free"
    ? "fireworks-ai"
    : group;
}
export function getDefaultProviderGroup(provider: ProviderId): ProviderGroupId {
  return provider;
}
