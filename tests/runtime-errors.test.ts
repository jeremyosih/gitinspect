import { describe, expect, it } from "vitest"
import { GitHubFsError } from "@/repo/github-fs"
import { classifyRuntimeError } from "@/agent/runtime-errors"

describe("classifyRuntimeError", () => {
  it("detects GitHub rate limit from GitHubFsError message", () => {
    const err = new GitHubFsError(
      "EACCES",
      "GitHub API rate limit exceeded (resets at 3:00:00 PM): /",
      "/"
    )
    const c = classifyRuntimeError(err)
    expect(c.kind).toBe("github_rate_limit")
    expect(c.action).toBe("open-github-settings")
    expect(c.severity).toBe("error")
  })

  it("detects provider connection failures", () => {
    const c = classifyRuntimeError(new Error("Connection error."))
    expect(c.kind).toBe("provider_connection")
    expect(c.source).toBe("provider")
  })

  it("detects GitHub auth failures", () => {
    const err = new GitHubFsError("EACCES", "Authentication required", "/")
    const c = classifyRuntimeError(err)
    expect(c.kind).toBe("github_auth")
    expect(c.action).toBe("open-github-settings")
    expect(c.source).toBe("github")
  })

  it("detects GitHub not found failures", () => {
    const err = new GitHubFsError("ENOENT", "README.md not found", "/README.md")
    const c = classifyRuntimeError(err)
    expect(c.kind).toBe("github_not_found")
    expect(c.severity).toBe("warning")
    expect(c.source).toBe("github")
  })

  it("distinguishes repository network failures from provider failures", () => {
    const c = classifyRuntimeError(new Error("Failed to fetch repository tree"))
    expect(c.kind).toBe("repo_network")
    expect(c.source).toBe("github")
  })
})
