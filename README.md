# gitinspect

![Screenshot 2026-03-28 at 01 36 31](https://github.com/user-attachments/assets/a39a420d-a538-4e8e-82a3-16794b3e0e6f)


Ask questions to any GitHub repo — from your browser, without cloning.
You can also replace hub with inspect in any GitHub URL to access the corresponding digest.

[try it here](https://gitinspect.com/)

**gitinspect** is a research agent for source code. Pick a repository, chat in natural language, and get answers grounded on the code. The agent is built on [pi-mono](https://github.com/badlogic/pi-mono) and explores the codebase through a **read-only virtual shell** ([just-bash](https://github.com/vercel-labs/just-bash)) mounted on a **virtual filesystem** backed by the **GitHub API** ([just-github](https://github.com/ThallesP/just-github) in this repo) — not your laptop, not a real checkout.

**Private by design.** Sessions, settings, provider keys, and usage stay on your device ([Dexie](https://github.com/dexie/Dexie.js) / IndexedDB). Chat runs client-side; we don’t run a backend for your data.

Inspired by [Sitegeist](https://sitegeist.ai) (browser-first, you stay in control) & [just-github](https://github.com/ThallesP/just-github).

## How it works

- **Local first** - the agent lives in a shared worker, and the data on a local Index DB.
- **Lazy loading** — nothing is fetched on construction, everything on demand
- **Tree cache** — the full repo tree is fetched once via Git Trees API, then all `stat`/`exists`/`readdir` calls are served from cache
- **Content cache** — file contents are cached by blob SHA (content-addressable, never stale)
- **Smart API selection** — Contents API for small files, raw endpoint for large ones (>1MB)

## Rate limits

Unauthenticated: 60 requests/hour. Authenticated: 5,000 requests/hour. Set `GITHUB_TOKEN` to avoid limits. The tree cache keeps actual API usage low — after the initial load, only `readFile` for new files costs an API call.

## License

[AGPL-3.0](LICENSE)
