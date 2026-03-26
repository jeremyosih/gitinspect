import { describe, expect, it } from "vitest"
import { createEmptyUsage } from "@/types/models"
import {
  getCostsByModelFromAggregates,
  getCostsByProviderFromAggregates,
  getTotalCostFromAggregates,
  mergeDailyCostAggregate,
} from "@/db/schema"

describe("db schema helpers", () => {
  it("merges daily cost aggregates by provider and model", () => {
    const usage = createEmptyUsage()
    usage.cost.total = 1.25

    expect(
      mergeDailyCostAggregate(undefined, usage, "openai-codex", "gpt-5.1", "2026-03-23")
    ).toEqual({
      byProvider: {
        "openai-codex": {
          "gpt-5.1": 1.25,
        },
      },
      date: "2026-03-23",
      total: 1.25,
    })
  })

  it("exposes total, provider, and model cost queries", () => {
    const dailyCosts = [
      {
        byProvider: {
          anthropic: {
            "claude-sonnet-4-6": 2,
          },
          "openai-codex": {
            "gpt-5.1": 3,
          },
        },
        date: "2026-03-23",
        total: 5,
      },
    ]

    expect(getTotalCostFromAggregates(dailyCosts)).toBe(5)
    expect(getCostsByProviderFromAggregates(dailyCosts)).toMatchObject({
      anthropic: 2,
      "openai-codex": 3,
    })
    expect(getCostsByModelFromAggregates(dailyCosts)).toMatchObject({
      "claude-sonnet-4-6": 2,
      "gpt-5.1": 3,
    })
  })
})
