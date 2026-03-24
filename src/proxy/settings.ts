import { deleteSetting, getSetting, setSetting } from "@/db/schema"

export interface ProxyConfig {
  enabled: boolean
  url: string
}

export const DEFAULT_PROXY_URL = "https://proxy.mariozechner.at/proxy"

const PROXY_ENABLED_KEY = "proxy.enabled"
const PROXY_URL_KEY = "proxy.url"

export async function getProxyConfig(): Promise<ProxyConfig> {
  try {
    const enabled = await getSetting(PROXY_ENABLED_KEY)
    const url = await getSetting(PROXY_URL_KEY)

    return {
      enabled: typeof enabled === "boolean" ? enabled : true,
      url: typeof url === "string" && url.length > 0 ? url : DEFAULT_PROXY_URL,
    }
  } catch {
    return {
      enabled: true,
      url: DEFAULT_PROXY_URL,
    }
  }
}

export async function setProxyConfig(config: ProxyConfig): Promise<void> {
  await setSetting(PROXY_ENABLED_KEY, config.enabled)

  if (config.url.length > 0) {
    await setSetting(PROXY_URL_KEY, config.url)
  } else {
    await deleteSetting(PROXY_URL_KEY)
  }
}
