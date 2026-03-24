import { Bash } from "just-bash";
import { createInterface } from "node:readline/promises";
import { GitHubFs } from "./src/github-fs.js";

const repo = process.argv[2] || "vercel-labs/just-bash";
const [owner, repoName] = repo.split("/");
const ref = process.argv[3] || "main";
const token = process.env.GITHUB_TOKEN;

if (!owner || !repoName) {
  console.error("Usage: npx tsx playground.ts owner/repo [ref]");
  process.exit(1);
}

const ghFs = new GitHubFs({ owner, repo: repoName, ref, token });
const bash = new Bash({ fs: ghFs, cwd: "/" });

console.log(`\n  just-github — browsing ${owner}/${repoName}@${ref}`);
console.log(`  ${token ? "authenticated" : "unauthenticated (set GITHUB_TOKEN for private repos)"}\n`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
let cwd = "/";

try {
  while (true) {
    const line = await rl.question(`${cwd} $ `);
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "exit" || trimmed === "quit") break;

    try {
      const cmd = cwd === "/" ? trimmed : `cd ${shellEscape(cwd)} && ${trimmed}`;
      const result = await bash.exec(cmd);
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      cwd = result.env?.PWD || cwd;
    } catch (err: any) {
      console.error(err.message ?? err);
    }
  }
} catch {
  // stdin closed (piped input or ctrl-d)
} finally {
  rl.close();
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
