import { deleteSetting, getSetting, setSetting } from "@gitinspect/db";

export interface ProxyConfig {
  enabled: boolean;
  url: string;
}

export const DEFAULT_PROXY_URL = "https://proxy.mariozechner.at/proxy";

/** Keys in `db.settings` — exported for reactive reads (e.g. `useLiveQuery`). */
export const PROXY_ENABLED_KEY = "proxy.enabled";
export const PROXY_URL_KEY = "proxy.url";

export function proxyConfigFromSettingsRows(
  rows: Array<{ key: string; value: unknown }>,
): ProxyConfig {
  const enabledRow = rows.find((row) => row.key === PROXY_ENABLED_KEY)?.value;
  const urlRow = rows.find((row) => row.key === PROXY_URL_KEY)?.value;

  return {
    enabled: typeof enabledRow === "boolean" ? enabledRow : true,
    url: typeof urlRow === "string" && urlRow.length > 0 ? urlRow : DEFAULT_PROXY_URL,
  };
}

export async function getProxyConfig(): Promise<ProxyConfig> {
  try {
    const [enabled, url] = await Promise.all([
      getSetting(PROXY_ENABLED_KEY),
      getSetting(PROXY_URL_KEY),
    ]);

    return proxyConfigFromSettingsRows([
      { key: PROXY_ENABLED_KEY, value: enabled },
      { key: PROXY_URL_KEY, value: url },
    ]);
  } catch {
    return {
      enabled: true,
      url: DEFAULT_PROXY_URL,
    };
  }
}

export async function setProxyConfig(config: ProxyConfig): Promise<void> {
  await setSetting(PROXY_ENABLED_KEY, config.enabled);

  if (config.url.length > 0) {
    await setSetting(PROXY_URL_KEY, config.url);
  } else {
    await deleteSetting(PROXY_URL_KEY);
  }
}
