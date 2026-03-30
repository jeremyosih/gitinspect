import { describe, expect, it } from "vitest"
import { GitHubFsError } from "@/repo/github-fs"
import {
  BusyRuntimeError,
  MissingSessionRuntimeError,
  StreamInterruptedRuntimeError,
} from "@/agent/runtime-command-errors"
import { buildSystemMessage, classifyRuntimeError } from "@/agent/runtime-errors"

describe("classifyRuntimeError", () => {
  it("detects busy runtime errors", () => {
    const classified = classifyRuntimeError(new BusyRuntimeError("session-1"))

    expect(classified.kind).toBe("runtime_busy")
    expect(classified.severity).toBe("warning")
    expect(classified.source).toBe("runtime")
  })

  it("detects missing session errors", () => {
    const classified = classifyRuntimeError(
      new MissingSessionRuntimeError("session-1")
    )

    expect(classified.kind).toBe("missing_session")
    expect(classified.severity).toBe("error")
    expect(classified.source).toBe("runtime")
  })

  it("detects stream interruptions", () => {
    const classified = classifyRuntimeError(new StreamInterruptedRuntimeError())

    expect(classified.kind).toBe("stream_interrupted")
    expect(classified.severity).toBe("error")
    expect(classified.source).toBe("runtime")
  })

  it("preserves fingerprints in persisted system messages", () => {
    const classified = classifyRuntimeError(
      new GitHubFsError("ENOENT", "README.md not found", "/README.md")
    )
    const message = buildSystemMessage(classified, "system-1", 123)

    expect(message.fingerprint).toBe(classified.fingerprint)
    expect(message.role).toBe("system")
    expect(message.kind).toBe(classified.kind)
  })

  it("detects provider rate limits", () => {
    const classified = classifyRuntimeError(new Error("429 Too Many Requests"))

    expect(classified.kind).toBe("provider_rate_limit")
    expect(classified.severity).toBe("error")
    expect(classified.source).toBe("provider")
  })

  it("detects provider api failures from provider diagnostics", () => {
    const classified = classifyRuntimeError(
      new Error(
        "Boom [fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo → https://api.fireworks.ai/inference/v1]"
      )
    )

    expect(classified.kind).toBe("provider_api")
    expect(classified.severity).toBe("error")
    expect(classified.source).toBe("provider")
  })

  it("extracts HTML payloads into structured system message details", () => {
    const classified = classifyRuntimeError(
      new Error(
        '429 <!DOCTYPE html><html><head><title>Vercel Security Checkpoint</title></head><body><p>We\'re verifying your browser</p></body></html> [fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo → https://api.fireworks.ai/inference/v1]'
      )
    )
    const message = buildSystemMessage(classified, "system-html", 456)

    expect(classified.kind).toBe("provider_rate_limit")
    expect(classified.message).toBe(
      "429 — Vercel Security Checkpoint"
    )
    expect(message.detailsContext).toBe(
      "[fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo → https://api.fireworks.ai/inference/v1]"
    )
    expect(message.detailsHtml).toContain("<title>Vercel Security Checkpoint</title>")
  })
})
