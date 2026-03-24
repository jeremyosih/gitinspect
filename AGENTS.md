# GitOverflow / Sitegeist Web v0

This repo is a strictly client-side browser app that recreates the core Sitegeist loop: auth, model selection, persistent sessions, streaming chat, resumable history, and local cost tracking.

## Hard no's

- No server, backend, or remote persistence.
- No extension-only or browser-coupled features: active-tab awareness, navigation messages, `browserjs`, REPL, DOM picking, native input events.
- No skills registry, custom tools UI, or tool execution in v0.
- No multi-device sync.
- No ad hoc storage wrappers; use `Dexie` for durable state.
- No onboarding flow for v0.

## Must keep

- Always use Bun to add packages, run test etc. 
- Must implement proxy like behavior exactly like sitegeist !
- Sessions survive reloads and browser restarts.
- Auth supports API keys and local OAuth credentials, including refresh.
- Model choice persists and can change mid-session.
- Assistant responses stream in the UI.
- Session history, settings, provider keys, usage, and cost data stay local.
- Keep the runtime/tool boundary clean so browser-safe tools can be added later without a rewrite.

## Working rules

- If a change needs server-side code or non-browser runtime support, stop and call it out as out of scope.
- Follow `SPEC.md` first when there is any conflict.
- Prefer a pragmatic v0 UI over final polish.

## Cursor Cloud specific instructions

### Tech stack
- **Runtime / package manager**: Bun (always use `bun` for install, test, run, etc.)
- **Framework**: React 19 + TanStack Router / Start, Vite 7
- **Styling**: Tailwind CSS 4, shadcn/ui (Radix), Phosphor icons
- **Local DB**: Dexie (IndexedDB)
- **Tests**: Vitest 3 + Testing Library + fake-indexeddb (jsdom)

### Common commands
See `package.json` scripts. Key ones:
- `bun run dev` — Vite dev server on port 3000
- `bun run test` — `vitest run`
- `bun run lint` — ESLint
- `bun run typecheck` — `tsc --noEmit`
- `bun run build` — production build
- `bun run format` — Prettier

### Known pre-existing issues
- **Lint**: exits with errors (mostly in `just-github/` sub-package — style rules like `array-type`, `import/order`). These are pre-existing, not caused by agent changes.
- **Typecheck**: 2 pre-existing TS errors in test files (`Property 'preconnect' does not exist on type`).
- **Tests**: 5 of 25 test files fail due to a broken import alias (`@/just-github/src/index` not resolving from `src/repo/github-fs.ts`). The remaining 20 test suites (85 tests) pass.

### Architecture notes
- Entirely client-side — no backend, no Docker, no `.env` files.
- Provider API keys are entered through the in-app Settings UI and stored in IndexedDB.
- A CORS proxy (configurable in settings) is used for Anthropic OAuth and OpenAI Codex requests.
- The `just-github/` directory is a standalone sub-package with its own `package.json` providing a GitHub fs-like API.
