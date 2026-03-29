import { beforeEach, describe, expect, it, vi } from "vitest"

const setProviderKey = vi.fn()
const oauthRefresh = vi.fn()
const getProxyConfig = vi.fn()

vi.mock("@/db/schema", () => ({
  db: {
    providerKeys: {},
    transaction: async (
      _mode: string,
      _table: Record<string, string>,
      callback: () => Promise<void>
    ) => await callback(),
  },
  getProviderKey: vi.fn(),
  setProviderKey,
}))

vi.mock("@/auth/auth-service", () => ({
  oauthRefresh,
}))

vi.mock("@/proxy/settings", () => ({
  getProxyConfig,
}))

describe("resolveStoredApiKey", () => {
  beforeEach(() => {
    setProviderKey.mockReset()
    oauthRefresh.mockReset()
    getProxyConfig.mockReset()
  })

  it("returns plain api keys unchanged", async () => {
    const { resolveStoredApiKey } = await import("@/auth/resolve-api-key")

    await expect(
      resolveStoredApiKey("sk-test", "openai-codex")
    ).resolves.toBe("sk-test")
  })

  it("refreshes expiring OAuth credentials and stores the update", async () => {
    const { resolveStoredApiKey } = await import("@/auth/resolve-api-key")
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    })
    oauthRefresh.mockResolvedValue({
      access: "next-access",
      expires: Date.now() + 120_000,
      providerId: "openai-codex",
      refresh: "next-refresh",
    })

    const result = await resolveStoredApiKey(
      JSON.stringify({
        access: "old-access",
        expires: Date.now() - 1,
        providerId: "openai-codex",
        refresh: "old-refresh",
      }),
      "openai-codex"
    )

    expect(result).toBe("next-access")
    expect(oauthRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        access: "old-access",
        providerId: "openai-codex",
        refresh: "old-refresh",
      })
    )
    expect(setProviderKey).toHaveBeenCalledTimes(1)
    expect(setProviderKey.mock.calls[0]?.[0]).toBe("openai-codex")
    expect(
      JSON.parse(String(setProviderKey.mock.calls[0]?.[1]))
    ).toMatchObject({
      access: "next-access",
      expires: expect.any(Number),
      providerId: "openai-codex",
      refresh: "next-refresh",
    })
  })

  it("passes a proxy url when anthropic oauth refresh is enabled", async () => {
    const { resolveStoredApiKey } = await import("@/auth/resolve-api-key")
    getProxyConfig.mockResolvedValue({
      enabled: true,
      url: "https://proxy.example/proxy",
    })
    oauthRefresh.mockResolvedValue({
      access: "next-access",
      expires: Date.now() + 120_000,
      providerId: "anthropic",
      refresh: "next-refresh",
    })

    await resolveStoredApiKey(
      JSON.stringify({
        access: "old-access",
        expires: Date.now() - 1,
        providerId: "anthropic",
        refresh: "old-refresh",
      }),
      "anthropic"
    )

    expect(oauthRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "anthropic",
        refresh: "old-refresh",
      }),
      {
        proxyUrl: "https://proxy.example/proxy",
      }
    )
  })

  it("keeps oauth refresh direct when proxy is disabled", async () => {
    const { resolveStoredApiKey } = await import("@/auth/resolve-api-key")
    getProxyConfig.mockResolvedValue({
      enabled: false,
      url: "https://proxy.example/proxy",
    })
    oauthRefresh.mockResolvedValue({
      access: "next-access",
      expires: Date.now() + 120_000,
      providerId: "anthropic",
      refresh: "next-refresh",
    })

    await resolveStoredApiKey(
      JSON.stringify({
        access: "old-access",
        expires: Date.now() - 1,
        providerId: "anthropic",
        refresh: "old-refresh",
      }),
      "anthropic"
    )

    expect(oauthRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "anthropic",
        refresh: "old-refresh",
      })
    )
  })

  it("returns the google oauth payload as token and project json", async () => {
    const { resolveStoredApiKey } = await import("@/auth/resolve-api-key")

    const result = await resolveStoredApiKey(
      JSON.stringify({
        access: "google-access",
        expires: Date.now() + 120_000,
        projectId: "project-1",
        providerId: "google-gemini-cli",
        refresh: "google-refresh",
      }),
      "google-gemini-cli"
    )

    expect(result).toBe(
      JSON.stringify({
        projectId: "project-1",
        token: "google-access",
      })
    )
  })

  it("falls back to the bundled public key for the Fireworks free group", async () => {
    const { resolveApiKeyForProvider } = await import("@/auth/resolve-api-key")
    const { getProviderKey } = await import("@/db/schema")
    const { FIREWORKS_FREE_PROXY_MARKER } = await import(
      "@/auth/public-provider-fallbacks"
    )

    vi.mocked(getProviderKey).mockResolvedValue(undefined)

    await expect(
      resolveApiKeyForProvider("fireworks-ai", "fireworks-free")
    ).resolves.toBe(FIREWORKS_FREE_PROXY_MARKER)
  })

  it("does not use the bundled public key for full OpenCode", async () => {
    const { resolveApiKeyForProvider } = await import("@/auth/resolve-api-key")
    const { getProviderKey } = await import("@/db/schema")

    vi.mocked(getProviderKey).mockResolvedValue(undefined)

    await expect(resolveApiKeyForProvider("opencode")).resolves.toBeUndefined()
  })
})
