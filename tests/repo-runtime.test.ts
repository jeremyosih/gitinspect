import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRepoRuntime, execInRepoShell } from "@/repo/repo-runtime"
import { installMockRepoFetch } from "./repo-test-utils"

describe("repo runtime", () => {
  beforeEach(() => {
    installMockRepoFetch()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("preserves cwd across shell calls", async () => {
    const runtime = createRepoRuntime({
      owner: "test-owner",
      ref: "main",
      repo: "test-repo",
    })

    await execInRepoShell(runtime, "cd src")

    expect(runtime.getCwd()).toBe("/src")

    const result = await execInRepoShell(runtime, "pwd")

    expect(result.stdout.trim()).toBe("/src")
  })
})
