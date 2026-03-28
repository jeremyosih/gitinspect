# gitinspect

![Screenshot 2026-03-28 at 01 36 31](https://github.com/user-attachments/assets/a39a420d-a538-4e8e-82a3-16794b3e0e6f)

Ask questions to any GitHub repo — from your browser, without cloning.

You can also replace hub with inspect in any GitHub URL to access the corresponding digest.

[website](https://gitinspect.com/) 

## How it works

- **Research agent** — Pick a repository, chat in natural language; answers are grounded in the code.
- **Stack** — [pi-mono](https://github.com/badlogic/pi-mono), read-only shell via [just-bash](https://github.com/vercel-labs/just-bash), virtual FS from the GitHub API ([just-github](https://github.com/ThallesP/just-github)).
- **Private by design** — Sessions, settings, provider keys, and usage stay on device ([Dexie](https://github.com/dexie/Dexie.js) / IndexedDB); chat is client-side, no backend for your data.
- **Local first** — Agent in a SharedWorker; durable state in IndexedDB.
- **Lazy loading** — Nothing fetched at construction; everything on demand.
- **Tree cache** — Full repo tree once via Git Trees API; `stat`, `exists`, and `readdir` from cache.
- **Content cache** — File contents by blob SHA (content-addressable, never stale).
- **Smart API selection** — Contents API for small files; raw endpoint for large files (>1 MB).

Inspired by [Sitegeist](https://sitegeist.ai) (browser-first, you stay in control) & [btca](https://github.com/davis7dotsh/better-context). (Asking Question to codebases)

## Rate limits

Unauthenticated: 60 requests/hour. Authenticated: 5,000 requests/hour. Set `GITHUB_TOKEN` to avoid limits. The tree cache keeps actual API usage low — after the initial load, only `readFile` for new files costs an API call.

## License

[AGPL-3.0](LICENSE)
