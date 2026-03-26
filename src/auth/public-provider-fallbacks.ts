import type { ProviderGroupId } from "@/types/models"

/**
 * Marker value returned for opencode-free so the client can detect the free
 * tier and route through the server proxy (which injects the real key).
 * The actual API key lives in process.env.OPENCODE_FREE_API_KEY on the server.
 */
export const OPENCODE_FREE_PROXY_MARKER = "__opencode_free__"

export function isOpencodeFreeMarker(apiKey: string): boolean {
  return apiKey === OPENCODE_FREE_PROXY_MARKER
}

export function getPublicApiKeyForProviderGroup(
  providerGroup?: ProviderGroupId
): string | undefined {
  if (providerGroup === "opencode-free") {
    return OPENCODE_FREE_PROXY_MARKER
  }

  return undefined
}
