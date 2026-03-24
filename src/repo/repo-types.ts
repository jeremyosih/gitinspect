import type { Bash, BashExecResult } from "just-bash/browser"
import type { GitHubFs } from "@/repo/github-fs"
import type { RepoSource } from "@/types/storage"

export interface RepoRuntime {
  bash: Bash
  fs: GitHubFs
  getCwd(): string
  getWarnings(): string[]
  refresh(): void
  setCwd(next: string): void
  source: RepoSource
}

export interface RepoExecResult extends BashExecResult {
  cwd: string
}
