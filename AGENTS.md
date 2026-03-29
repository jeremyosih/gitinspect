# gitinspect.com

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
- STATE should be stored in params (UI State) or Dexie (Persisted State)
- Must implement proxy like behavior exactly like sitegeist !
- Sessions survive reloads and browser restarts.
- Auth supports API keys and local OAuth credentials, including refresh.
- Model choice persists and can change mid-session.
- Assistant responses stream in the UI.
- Session history, settings, provider keys, usage, and cost data stay local.
- Keep the runtime/tool boundary clean so browser-safe tools can be added later without a rewrite.

## Working rules

- **TanStack Router `src/routes/`**: Only real route modules live here; each must export `Route`. Put hooks, helpers, or search-param factories elsewhere (e.g. `src/`), or name ignored files with the `-` prefix (e.g. `-helpers.ts`) so they are not scanned as routes.
- If a change needs server-side code or non-browser runtime support, stop and call it out as out of scope.
