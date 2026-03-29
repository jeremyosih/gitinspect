import { describe, expect, it } from "vitest"
import { createEmptyUsage } from "@/types/models"
import { serializeOAuthCredentials } from "@/auth/oauth-types"
import {
  DEFAULT_MODELS,
  calculateCost,
  getCanonicalProvider,
  getConnectedProviders,
  getDefaultModel,
  getDefaultModelForGroup,
  getModel,
  getModelsForGroup,
  getProviderGroups,
} from "@/models/catalog"
import { FIREWORKS_KIMI_K25_TURBO_ID } from "@/models/builtin-models"
import type { ProviderGroupId } from "@/types/models"

describe("model catalog", () => {
  it("does not treat a non-OAuth openai-codex key as connected", () => {
    const connected = getConnectedProviders([
      { provider: "openai-codex", value: "sk-not-oauth" },
    ])

    expect(connected).not.toContain("openai-codex")
  })

  it("treats valid OpenAI Codex OAuth credentials as connected", () => {
    const connected = getConnectedProviders([
      {
        provider: "openai-codex",
        value: serializeOAuthCredentials({
          access: "access-token",
          expires: Date.now() + 60_000,
          providerId: "openai-codex",
          refresh: "refresh-token",
        }),
      },
    ])

    expect(connected).toContain("openai-codex")
  })

  it("limits OpenAI groups to GPT-5.4 / Mini / Nano in that order", () => {
    const expected = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"]
    expect(getModelsForGroup("openai").map((m) => m.id)).toEqual(expected)
    expect(getModelsForGroup("openai-codex").map((m) => m.id)).toEqual(expected)
  })

  it("sorts non-OpenAI models by id descending (newer ids first)", () => {
    const models = getModelsForGroup("anthropic")
    const ids = models.map((model) => model.id)
    const sorted = [...ids].sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" })
    )

    expect(ids).toEqual(sorted)
  })

  it("returns the configured default models", () => {
    expect(getDefaultModel("openai-codex").id).toBe(DEFAULT_MODELS["openai-codex"])
    expect(getDefaultModel("anthropic").id).toBe(DEFAULT_MODELS.anthropic)
  })

  it("falls back to the provider default when the requested model is missing", () => {
    expect(getModel("github-copilot", "missing-model").id).toBe("gpt-4o")
  })

  it("exposes the Fireworks free group and canonicalizes to fireworks-ai", () => {
    expect(getProviderGroups()).toEqual(
      expect.arrayContaining(["opencode", "fireworks-free"])
    )
    expect(getCanonicalProvider("fireworks-free")).toBe("fireworks-ai")
  })

  it("exposes the Fireworks free tier builtin model", () => {
    const freeModels = getModelsForGroup("fireworks-free")
    expect(freeModels.map((m) => m.id)).toEqual([FIREWORKS_KIMI_K25_TURBO_ID])
    expect(getDefaultModelForGroup("fireworks-free").id).toBe(
      FIREWORKS_KIMI_K25_TURBO_ID
    )
    expect(getDefaultModel("fireworks-ai").id).toBe(FIREWORKS_KIMI_K25_TURBO_ID)
  })

  it("maps legacy opencode-free persisted group id to Fireworks models", () => {
    expect(
      getDefaultModelForGroup("opencode-free" as ProviderGroupId).id
    ).toBe(FIREWORKS_KIMI_K25_TURBO_ID)
    expect(getCanonicalProvider("opencode-free" as ProviderGroupId)).toBe(
      "fireworks-ai"
    )
  })

  it("calculates per-message cost from usage totals", () => {
    const model = getModel("openai-codex", "gpt-5.1-codex-mini")
    const usage = createEmptyUsage()
    usage.input = 1_000
    usage.output = 500
    usage.totalTokens = 1_500

    expect(calculateCost(model, usage)).toEqual({
      cacheRead: 0,
      cacheWrite: 0,
      input: 0.00025,
      output: 0.001,
      total: 0.00125,
    })
  })
})
