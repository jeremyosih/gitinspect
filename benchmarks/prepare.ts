import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cpus } from "node:os";

export const BASELINE_COMMIT = "0f30313ef198d1aecc380489cd2429f51d4a9371";
export const baseline = resolve(import.meta.dir, "../.cache/benchmark-baseline");
export const output = resolve(import.meta.dir, "../.cache/benchmark");

export async function prepare() {
  const run = async (cmd: string[], cwd: string) => {
    const child = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
    if ((await child.exited) !== 0) throw new Error(`Failed: ${cmd.join(" ")}`);
  };
  const root = resolve(import.meta.dir, "..");
  if (!existsSync(resolve(baseline, ".git")))
    await run(["git", "worktree", "add", "--detach", baseline, BASELINE_COMMIT], root);
  if (!existsSync(resolve(baseline, "node_modules/@mariozechner/pi-agent-core")))
    await run(["bun", "install", "--frozen-lockfile"], baseline);
  const checkedOut = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: baseline });
  if (checkedOut.exitCode !== 0 || checkedOut.stdout.toString().trim() !== BASELINE_COMMIT)
    throw new Error("Benchmark baseline is at the wrong commit");
  mkdirSync(output, { recursive: true });
  const candidate = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root });
  writeFileSync(
    resolve(output, "revision.json"),
    JSON.stringify(
      { candidateCommit: candidate.stdout.toString().trim(), cpu: cpus()[0]?.model },
      null,
      2,
    ),
  );
  const entry = resolve(output, "pi-entry.ts");
  writeFileSync(
    entry,
    `
export { Agent } from ${JSON.stringify(resolve(baseline, "node_modules/@mariozechner/pi-agent-core/dist/agent.js"))};
export { getModel } from ${JSON.stringify(resolve(baseline, "node_modules/@mariozechner/pi-ai/dist/models.js"))};
export { streamSimpleOpenAICodexResponses } from ${JSON.stringify(resolve(baseline, "node_modules/@mariozechner/pi-ai/dist/providers/openai-codex-responses.js"))};
`,
  );
  if (!existsSync(resolve(output, "pi-browser.js"))) {
    const build = await Bun.build({
      entrypoints: [entry],
      outdir: output,
      naming: "pi-browser.js",
      target: "browser",
      external: ["node:*"],
      minify: false,
    });
    if (!build.success) throw new AggregateError(build.logs, "Could not bundle baseline Pi");
  }
  console.log(`Baseline ${BASELINE_COMMIT}; browser module: /.cache/benchmark/pi-browser.js`);
  console.log(
    `Browser console: await import(${JSON.stringify(`/@fs${root}/benchmarks/browser-run.ts`)}).then(m => m.runBrowserBenchmarks()).then(result => { console.log(result); window.__gitinspectBenchmarkResult = result; })`,
  );
}
if (import.meta.main) await prepare();
