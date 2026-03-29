import { describe, expect, it } from "vitest"
import { FIREWORKS_FREE_PROXY_MARKER } from "@/auth/public-provider-fallbacks"
import { shouldUseProxyForProvider } from "@/agent/provider-proxy"

describe("provider-proxy", () => {
  it("proxies Fireworks free tier when the API key is the free-tier marker", () => {
    expect(
      shouldUseProxyForProvider("fireworks-ai", FIREWORKS_FREE_PROXY_MARKER)
    ).toBe(true)
  })

  it("does not proxy Fireworks with a real-looking key through the free-tier path", () => {
    expect(shouldUseProxyForProvider("fireworks-ai", "fw-real-key")).toBe(false)
  })
})
