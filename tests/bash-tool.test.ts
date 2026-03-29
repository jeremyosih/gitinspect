import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createRepoRuntime } from "@/repo/repo-runtime"
import * as repoRuntimeModule from "@/repo/repo-runtime"
import { createBashTool } from "@/tools/bash"
import { installMockRepoFetch } from "./repo-test-utils"

describe("bash tool", () => {
  beforeEach(() => {
    installMockRepoFetch()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("executes commands against the virtual repository shell", async () => {
    const runtime = createRepoRuntime({
      owner: "test-owner",
      ref: "main",
      repo: "test-repo",
    })
    const tool = createBashTool(runtime)

    await tool.execute("call-1", { command: "cd src" })
    const result = await tool.execute("call-2", { command: "pwd" })
    const firstPart = result.content[0]

    expect(firstPart?.type).toBe("text")
    expect(firstPart?.type === "text" ? firstPart.text.trim() : "").toBe("/src")
  })

  it("fails on writes to the read-only repository fs", async () => {
    const runtime = createRepoRuntime({
      owner: "test-owner",
      ref: "main",
      repo: "test-repo",
    })
    const tool = createBashTool(runtime)

    await expect(
      tool.execute("call-3", { command: "echo hi > note.txt" })
    ).rejects.toThrow("Read-only filesystem")
  })

  it("calls onRepoError when bash exits non-zero", async () => {
    const runtime = createRepoRuntime({
      owner: "test-owner",
      ref: "main",
      repo: "test-repo",
    })
    const onRepoError = vi.fn(async () => {})
    vi.spyOn(repoRuntimeModule, "execInRepoShell").mockResolvedValue({
      cwd: "/",
      env: { PWD: "/" },
      exitCode: 2,
      stderr: "ls: .: No such file or directory",
      stdout: "",
    })
    const tool = createBashTool(runtime, onRepoError)

    await expect(tool.execute("call-4", { command: "ls" })).rejects.toThrow()
    expect(onRepoError).toHaveBeenCalled()
  })
})
