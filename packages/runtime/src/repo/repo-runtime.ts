import { Bash } from "just-bash/browser";
import { GitHubFs } from "@gitinspect/vfs/github-fs";
import type { ResolvedRepoSource } from "@gitinspect/db";
import { resolveRegisteredGitHubAccess } from "@gitinspect/runtime/repo/github-access";
import type { RepoExecResult, RepoRuntime } from "@gitinspect/runtime/repo/repo-types";

async function resolveRuntimeRepoToken(): Promise<string | undefined> {
  const access = await resolveRegisteredGitHubAccess({ requireRepoScope: true });
  return access.ok ? access.token : undefined;
}

function shellEscape(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function normalizeCwd(next: string | undefined): string {
  if (!next || next === ".") {
    return "/";
  }

  if (next.startsWith("/")) {
    return next;
  }

  return `/${next}`;
}

// Immutable snapshots are safe to reuse across turns. Cwd/shell state remains per chat.
const snapshotPool = new Map<string, GitHubFs>();
const MAX_RETAINED_SNAPSHOTS = 4;
function snapshotKey(source: ResolvedRepoSource, sha: string): string {
  return `${source.owner}/${source.repo}@${sha}`;
}
export async function retainRepoSnapshot(
  runtime: RepoRuntime,
  signal?: AbortSignal,
): Promise<string> {
  const sha = await runtime.fs.snapshotCommit(signal);
  const key = snapshotKey(runtime.source, sha);
  snapshotPool.delete(key);
  snapshotPool.set(key, runtime.fs);
  while (snapshotPool.size > MAX_RETAINED_SNAPSHOTS)
    snapshotPool.delete(snapshotPool.keys().next().value!);
  return sha;
}

export function createRepoRuntime(source: ResolvedRepoSource): RepoRuntime {
  const key =
    source.resolvedRef.kind === "commit" ? snapshotKey(source, source.resolvedRef.sha) : undefined;
  const fs =
    (key ? snapshotPool.get(key) : undefined) ??
    new GitHubFs({
      cache: { contentMaxBytes: 12.5 * 1024 * 1024 },
      owner: source.owner,
      ref: source.resolvedRef,
      repo: source.repo,
      getToken: async () => await resolveRuntimeRepoToken(),
    });
  const bash = new Bash({
    cwd: "/",
    fs,
  });
  let cwd = "/";

  return {
    bash,
    fs,
    getCwd() {
      return cwd;
    },
    getWarnings() {
      return fs.warnings.map((warning) => warning.message);
    },
    refresh() {
      fs.refresh();
    },
    setCwd(next) {
      cwd = normalizeCwd(next);
    },
    source,
  };
}

export function createOptionalRepoRuntime(
  source: ResolvedRepoSource | undefined,
): RepoRuntime | undefined {
  if (!source) {
    return undefined;
  }

  return createRepoRuntime(source);
}

export async function execInRepoShell(
  runtime: RepoRuntime,
  command: string,
  signal?: AbortSignal,
): Promise<RepoExecResult> {
  const cwd = runtime.getCwd();
  const script = cwd === "/" ? command : `cd ${shellEscape(cwd)}\n${command}`;
  const shell = signal ? new Bash({ cwd, fs: runtime.fs.withSignal(signal) }) : runtime.bash;
  const result = await shell.exec(script, {
    cwd,
    signal,
  });
  const nextCwd = result.env.PWD;

  if (nextCwd) {
    runtime.setCwd(nextCwd);
  }

  return {
    ...result,
    cwd: runtime.getCwd(),
  };
}
