function getLocationHref(): string | undefined {
  const locationValue = globalThis.location;

  if (
    locationValue &&
    typeof locationValue === "object" &&
    "href" in locationValue &&
    typeof locationValue.href === "string"
  ) {
    return locationValue.href;
  }

  return undefined;
}

export function resolveProxyBaseUrl(proxyBaseUrl: string): string {
  const trimmed = proxyBaseUrl.trim();
  const locationHref = getLocationHref();

  if (!locationHref) {
    return trimmed;
  }

  return new URL(trimmed, locationHref).toString();
}

export function buildProxiedUrl(proxyBaseUrl: string, targetUrl: string): string {
  const base = resolveProxyBaseUrl(proxyBaseUrl).replace(/\/+$/, "");
  return `${base}/?url=${encodeURIComponent(targetUrl)}`;
}
