import { Bash } from "just-bash/browser";
import { GitHubFs } from "@gitinspect/just-github/github-fs";
import type { ResolvedRepoSource } from "@gitinspect/db";
import { resolveRegisteredGitHubAccess } from "@gitinspect/pi/repo/github-access";
import type { RepoExecResult, RepoRuntime } from "@gitinspect/pi/repo/repo-types";

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

export function createRepoRuntime(source: ResolvedRepoSource): RepoRuntime {
  const fs = new GitHubFs({
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
  const result = await runtime.bash.exec(script, {
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
