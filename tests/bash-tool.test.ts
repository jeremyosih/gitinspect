import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubFsError } from "@/lib/github";
import { createRepoRuntime } from "@/repo/repo-runtime";
import * as repoRuntimeModule from "@/repo/repo-runtime";
import type { RepoRuntime } from "@/repo/repo-types";
import { createBashTool } from "@/tools/bash";
import { installMockRepoFetch, TEST_REPO_SOURCE } from "./repo-test-utils";

describe("bash tool", () => {
  beforeEach(() => {
    installMockRepoFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("executes commands against the virtual repository shell", async () => {
    const runtime = createRepoRuntime(TEST_REPO_SOURCE);
    const tool = createBashTool(runtime);

    await tool.execute("call-1", { command: "cd src" });
    const result = await tool.execute("call-2", { command: "pwd" });
    const firstPart = result.content[0];

    expect(firstPart?.type).toBe("text");
    expect(firstPart?.type === "text" ? firstPart.text.trim() : "").toBe("/src");
  });

  it("allows safe redirects like /dev/null in the read-only repository shell", async () => {
    const runtime = createRepoRuntime(TEST_REPO_SOURCE);
    const tool = createBashTool(runtime);

    const result = await tool.execute("call-3", {
      command: "cat missing.txt 2>/dev/null || echo fallback",
    });
    const firstPart = result.content[0];

    expect(firstPart?.type).toBe("text");
    expect(firstPart?.type === "text" ? firstPart.text.trim() : "").toBe("fallback");
  });

  it("does not reject harmless commands that only mention write-like words", async () => {
    const runtime = createRepoRuntime(TEST_REPO_SOURCE);
    const tool = createBashTool(runtime);

    const result = await tool.execute("call-4", { command: "echo rm" });
    const firstPart = result.content[0];

    expect(firstPart?.type).toBe("text");
    expect(firstPart?.type === "text" ? firstPart.text.trim() : "").toBe("rm");
  });

  it("fails on writes to the read-only repository fs", async () => {
    const runtime = createRepoRuntime(TEST_REPO_SOURCE);
    const tool = createBashTool(runtime);

    await expect(tool.execute("call-5", { command: "echo hi > note.txt" })).rejects.toThrow(
      "Read-only filesystem",
    );
  });

  it("preserves the underlying GitHub error when bash exits non-zero", async () => {
    const error = new GitHubFsError(
      "EACCES",
      "GitHub API rate limit exceeded (retry after 3:00:00 PM): /",
      "/",
    );
    const runtime = {
      bash: {} as RepoRuntime["bash"],
      fs: {
        clearLastError: vi.fn(),
        consumeLastError: vi.fn(() => error),
      } as unknown as RepoRuntime["fs"],
      getCwd: () => "/",
      getWarnings: () => [],
      refresh: vi.fn(),
      setCwd: vi.fn(),
      source: {
        owner: "test-owner",
        ref: "main",
        refOrigin: "explicit",
        repo: "test-repo",
        resolvedRef: TEST_REPO_SOURCE.resolvedRef,
      },
    } satisfies RepoRuntime;
    const onRepoError = vi.fn(async () => {});
    const execSpy = vi.spyOn(repoRuntimeModule, "execInRepoShell").mockResolvedValue({
      cwd: "/",
      env: { PWD: "/" },
      exitCode: 2,
      stderr: "ls: .: No such file or directory",
      stdout: "",
    });
    const tool = createBashTool(runtime, onRepoError);

    await expect(tool.execute("call-7", { command: "ls" })).rejects.toBe(error);
    expect(execSpy).toHaveBeenCalled();
    expect(runtime.fs.clearLastError).toHaveBeenCalled();
    expect(runtime.fs.consumeLastError).toHaveBeenCalled();
    expect(onRepoError).toHaveBeenCalledWith(error);
  });
});
