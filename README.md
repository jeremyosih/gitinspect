# gitinspect

![Screenshot 2026-03-28 at 01 36 31](https://github.com/user-attachments/assets/a39a420d-a538-4e8e-82a3-16794b3e0e6f)

Ask questions about any GitHub repo from your browser—without cloning.

You can replace `hub` with `inspect` in any GitHub URL to open the corresponding view here.

**Site:** [gitinspect.com](https://gitinspect.com/)

---

## Privacy

**Chats and credentials stay in this browser by default**, in IndexedDB via [Dexie](https://github.com/dexie/Dexie.js). There is no account sync. Publishing a share uploads a public transcript snapshot to a Cloudflare Durable Object; unpublishing removes that public snapshot. Provider credentials and fx checkpoints stay local.

Your browser calls GitHub and the model provider you connect. Provider requests can use the proxy configured in Settings. There is no bundled model key, paid plan, or billing service.

---

## Models & GitHub access (two different things)

|                          | What it’s for                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Settings → Providers** | LLM API keys / OAuth. Use this for the models you want and for providers you pay for.                                                   |
| **Settings → GitHub**    | Optional **PAT** stored only in this browser: higher GitHub API rate limits (60/h → 5,000/h) and richer repo metadata where applicable. |

Connect your own API key or existing provider subscription in **Settings → Providers** to chat. ChatGPT subscription OAuth remains available separately from OpenAI API keys.

---

## Analytics

We use **Vercel** (hosting) and **OneDollar Stats** for **aggregate** traffic and product analytics. These are **private** to the project—**not** used to read your chats, prompts, or repository contents. Chat routes are excluded from page analytics where configured.

---

## How it works

- **Research agent** — Pick a repository, chat in natural language; answers are grounded in the code.
- **Stack** — [Pi Durable](https://github.com/earendil-works/pi) runs the agent: model turns, tool calls and the conversation. The app drives it through [effect-pi-durable](https://github.com/jeremyosih/effect-pi-durable), so the harness, its tools and its model access are [Effect](https://effect.website/) layers, services and streams. Effect also owns resource scopes, serialized operations, HTTP concurrency and cancellation. The existing read-only [just-bash](https://github.com/vercel-labs/just-bash) shell uses `@gitinspect/vfs`.
- **Browser storage** — The transcript in IndexedDB is a conversation's durable state. Each session's Pi harness keeps its conversation in memory; a new worker starts the conversation from the transcript, so the model reads earlier turns as the messages they were. There are no engine checkpoints to keep in step with the transcript. An interrupted answer stays a draft and is not sent back to the model.
- **Providers** — [Pi AI](https://github.com/earendil-works/pi/tree/main/packages/ai) speaks each provider's API with the user's own key or subscription, read from the app's credential store; requests go through the configured proxy only for credentials that need it. ChatGPT subscription login uses the existing OAuth flow against the Codex Responses endpoint; it is separate from an OpenAI API key. Gemini CLI subscriptions use a small Cloud Code Assist adapter in this repository, because Pi AI 1.0 has none.
- **Workers** — Agent work and durable turn writes run in a per-tab DedicatedWorker. The main thread manages leases, observes IndexedDB, and repairs interrupted sessions. Workers do not guarantee background-tab execution.
- **Snapshots** — All repository reads use one immutable commit. A new snapshot resolves a changed branch; refreshing its caches keeps the same commit. Completed conversations retain the commit across worker restarts.
- **Trees** — Concurrent tree loads share one request. Complete trees have indexed directory children. Truncated recursive responses fall back to complete non-recursive directory trees, fetched lazily, so missing entries never become false `ENOENT` results.
- **Blobs** — Canonical bytes cached by SHA serve both text and binary reads. In-flight fetches are shared; cancelling one reader does not cancel other readers. The final cancellation aborts HTTP. The cache refuses oversized entries. Four retained worker snapshots have a combined 50 MiB content budget; active snapshots have the same individual bounds. Files default to a 10 MiB read limit and API responses to 32 MiB.
- **Compatibility** — The agent is plain JavaScript and needs no WebAssembly JSPI. Pi Durable is experimental and pinned at 1.0.1. `effect-pi-durable` is not on npm yet; [`vendor/`](vendor/README.md) holds the build this app uses. No claim of faster model inference is implied by this migration.

Inspired by [Sitegeist](https://sitegeist.ai), [btca](https://github.com/davis7dotsh/better-context) & [repogrep](https://repogrep.com).

---

## Performance measurements

[Reproducible benchmarks and results](benchmarks/README.md) compare this cleanup with the original commit. The VFS improves repeated reads and indexed directory listings, but cold reads and bursts of different files can be slower. The Pi Durable agent adds a few milliseconds of warm overhead per turn in the controlled browser benchmark, about what the fx engine it replaced added; this migration is not a model-inference speedup.

## Public sharing service

The web app can remain on its current host. `apps/sharing` is a standalone Cloudflare Worker with one SQLite-backed Durable Object per share; `packages/infra/alchemy.run.ts` defines it in Alchemy. Moving the full web app to Cloudflare is a separate decision.

1. Copy `packages/infra/.env.example` to `.env` in that directory and set a random 32+ character `SHARING_SERVICE_SECRET`.
2. Run `bun run --cwd packages/infra dev` for local Alchemy development (port 3002). Run `plan` to review cloud changes before using `deploy`.
3. Configure the web server's `SHARING_SERVICE_URL` with that service URL and the same `SHARING_SERVICE_SECRET`. Neither is required for local chats; without them sharing returns 503.

The web server authenticates the account and forwards mutations with a service secret. The DO keeps ownership private, preserves it across unpublish, and replaces each public snapshot in one SQL transaction. Public reads include only the selected transcript, never account IDs, provider keys or fx checkpoints. Payloads are validated and bounded at 2 MiB / 1,000 messages. Sharing needs GitHub sign-in; chatting with your own provider does not.

Existing Dexie Cloud public snapshots are not copied automatically. Republish their local conversations after configuring the new service to keep the same share URLs. Private chats and credentials are preserved by the local database migration.

The SQLite service is tested locally with Miniflare, including persistence across restart and ownership enforcement. Cloud resources have not been deployed by this cleanup. Retain the service and DO namespace when changing infrastructure; Alchemy's Worker has a retain removal policy.

---

## Rate limits (GitHub API)

Unauthenticated: **60 requests/hour**. With a token: **5,000/hour**. Add a token under **Settings → GitHub** in the app (stored only in your browser). The tree cache keeps real usage low after the first load.

---

## AI Disclosure

This codebase has been built with a lot of support from AI. Very little is hand-written; **GPT 5.4** was used to create this repository alongside that small amount of manual code. (Not proud of code quality rn but it works and will be cleaned up)

---

## License

[AGPL-3.0](LICENSE)
