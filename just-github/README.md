# just-github

An `fs`-like API for reading files from GitHub repositories — without cloning.

## Install

```bash
npm install just-github
```

## Usage

```typescript
import { GitHubFs } from "just-github";

const fs = new GitHubFs({
  owner: "vercel-labs",
  repo: "just-bash",
  ref: "main", // branch, tag, or commit SHA (default: "main")
  token: process.env.GITHUB_TOKEN, // optional, for private repos
});

await fs.readFile("src/index.ts"); // string
await fs.readFileBuffer("src/index.ts"); // Uint8Array
await fs.readdir("src/"); // string[]
await fs.readdirWithFileTypes("src/"); // { name, isFile, isDirectory, isSymbolicLink }[]
await fs.stat("package.json"); // { isFile, isDirectory, isSymbolicLink, size, mode, mtime }
await fs.exists("README.md"); // boolean
await fs.tree(); // all file paths in the repo
```

### With just-bash

`GitHubFs` implements just-bash's `IFileSystem` interface, so you can use it as a drop-in filesystem:

```typescript
import { Bash } from "just-bash";
import { GitHubFs } from "just-github";

const fs = new GitHubFs({ owner: "vercel-labs", repo: "just-bash" });
const bash = new Bash({ fs, cwd: "/" });

const result = await bash.exec("cat README.md | head -5");
console.log(result.stdout);
```

### Playground

There's a playground script that drops you into an interactive shell over any GitHub repo:

```bash
npx tsx playground.ts owner/repo [ref]
```

## How it works

- **Lazy loading** — nothing is fetched on construction, everything on demand
- **Tree cache** — the full repo tree is fetched once via Git Trees API, then all `stat`/`exists`/`readdir` calls are served from cache
- **Content cache** — file contents are cached by blob SHA (content-addressable, never stale)
- **Smart API selection** — Contents API for small files, raw endpoint for large ones (>1MB)

## Rate limits

Unauthenticated: 60 requests/hour. Authenticated: 5,000 requests/hour. Set `GITHUB_TOKEN` to avoid limits. The tree cache keeps actual API usage low — after the initial load, only `readFile` for new files costs an API call.

## License

MIT
