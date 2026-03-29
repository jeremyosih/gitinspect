import type { ProviderGroupId } from "@/types/models"

/**
 * Marker value returned for fireworks-free so the client can detect the free
 * tier and route through the server proxy (which injects the real key).
 * The actual API key lives in process.env.FIREWORKS_API_KEY on the server.
 */
export const FIREWORKS_FREE_PROXY_MARKER = "__fireworks_free__"

export function isFreeTierProxyMarker(apiKey: string): boolean {
  return apiKey === FIREWORKS_FREE_PROXY_MARKER
}

export function getPublicApiKeyForProviderGroup(
  providerGroup?: ProviderGroupId
): string | undefined {
  if (providerGroup === "fireworks-free") {
    return FIREWORKS_FREE_PROXY_MARKER
  }

  return undefined
}
