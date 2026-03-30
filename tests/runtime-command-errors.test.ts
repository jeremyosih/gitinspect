import { describe, expect, it } from "vitest"
import { getRuntimeCommandErrorMessage } from "@/agent/runtime-command-errors"

describe("getRuntimeCommandErrorMessage", () => {
  it("maps Vercel security checkpoint errors to a specific toast", () => {
    expect(
      getRuntimeCommandErrorMessage(
        new Error("429 — Vercel Security Checkpoint")
      )
    ).toBe(
      "A Vercel security checkpoint blocked this request. Expand the system notice to inspect the returned HTML."
    )
  })

  it("keeps generic provider 429 messages mapped to rate limiting", () => {
    expect(getRuntimeCommandErrorMessage(new Error("429 Too Many Requests"))).toBe(
      "The selected provider is rate limited right now. Wait a bit or switch to another model."
    )
  })
})
