import { streamSimple } from "@mariozechner/pi-ai"
import type { Api, Model, SimpleStreamOptions } from "@mariozechner/pi-ai"
import { isFreeTierProxyMarker } from "@/auth/public-provider-fallbacks"
import { getProxyConfig } from "@/proxy/settings"
import { buildProxiedUrl } from "@/proxy/url"

export function shouldUseProxyForProvider(
  provider: string,
  apiKey: string
): boolean {
  if (isFreeTierProxyMarker(apiKey)) {
    return provider.toLowerCase() === "fireworks-ai"
  }
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

export function createProxyAwareStreamFn() {
  return async <TApi extends Api>(
    model: Model<TApi>,
    context: Parameters<typeof streamSimple>[1],
    options?: SimpleStreamOptions
  ) => {
    const apiKey = options?.apiKey

    if (!apiKey) {
      return await streamSimple(model, context, options)
    }

    const proxyUrl = isFreeTierProxyMarker(apiKey)
      ? "/api/proxy"
      : await (async () => {
          const proxy = await getProxyConfig()
          return proxy.enabled ? proxy.url : undefined
        })()

    if (!proxyUrl) {
      return await streamSimple(model, context, options)
    }

    const proxiedModel = applyProxyIfNeeded(model, apiKey, proxyUrl)
    return await streamSimple(proxiedModel, context, options)
  }
}
