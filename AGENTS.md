# gitinspect.com / Sitegeist Web v0

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
- Works on both desktop and mobile browsers. On browsers with `SharedWorker` support the runtime is shared across tabs; on browsers without it (e.g. Chrome Android) the runtime falls back to a dedicated `Worker` per tab.
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
