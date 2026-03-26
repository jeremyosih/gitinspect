# Plan: Universal Worker Fallback

## Problem

`runtime-client.ts` hard-gates on `SharedWorker`:

```ts
if (typeof window === "undefined" || typeof SharedWorker === "undefined") {
  throw new Error("SharedWorker runtime is only available in supported desktop browsers")
}
```

This means the entire agent/chat pipeline is dead on any browser without native `SharedWorker` support. The main casualty is **Chrome Android** — the largest mobile browser — plus Samsung Internet, Opera Mobile, UC Browser, and others.

## Goal

Make the app work in **every browser that supports `Worker`** (effectively all modern browsers). When native `SharedWorker` is available, use it for cross-tab sharing. When it isn't, silently degrade to a dedicated `Worker` per tab. No new dependencies needed — `vite-plugin-comlink` already provides both `ComlinkWorker` and `ComlinkSharedWorker`.

## Architecture

### Current flow

```
UI → RuntimeClient.ensureConnected()
       → createWorkerApi()
           → new ComlinkSharedWorker(URL, opts)  // throws if SharedWorker absent
               → Comlink proxy → runtime-shared-worker.ts → SessionRuntimeRegistry
```

### Proposed flow

```
UI → RuntimeClient.ensureConnected()
       → createWorkerApi()
           → SharedWorker available?
               YES → new ComlinkSharedWorker(URL, opts)   // shared across tabs
               NO  → new ComlinkWorker(URL, opts)         // isolated per tab
           → Comlink proxy → runtime-worker.ts → SessionRuntimeRegistry
```

Both `ComlinkSharedWorker` and `ComlinkWorker` return `Remote<T>` — the same Comlink proxy shape, typed against the worker module's exports. `RuntimeClient` doesn't need to know which one was chosen.

### Trade-off accepted

On browsers without `SharedWorker`, each tab gets its own `SessionRuntimeRegistry`. Sessions are already persisted to Dexie (IndexedDB), so switching tabs still loads the correct session data — each tab just runs its own runtime host. There is no cross-tab coordination today beyond the shared worker singleton, so nothing breaks; the user just can't have two tabs driving the same session simultaneously (which was already unsupported at the UI level).

---

## Files changed

| File | Change |
|------|--------|
| `src/agent/runtime-client.ts` | Rewrite `createWorkerApi()` with fallback logic, export `workerMode` |
| `src/agent/runtime-shared-worker.ts` | Rename to `runtime-worker.ts` (serves both modes) |
| `src/agent/runtime-worker-types.ts` | Add `WorkerMode` type |
| `tests/runtime-audit.test.ts` | Update file path reference |
| `tests/session-actions.test.ts` | No change needed (mocks `runtimeClient`) |

---

## Implementation

### Step 1: Rename `runtime-shared-worker.ts` → `runtime-worker.ts` ✅

The worker entry file has no SharedWorker-specific code — it just exports bound methods. Renaming it clarifies that it serves both worker types.

**`src/agent/runtime-worker.ts`** (same content, new name):

```ts
import { SessionRuntimeRegistry } from "@/agent/session-runtime-registry"

const registry = new SessionRuntimeRegistry()

export const ensureSession = registry.ensureSession.bind(registry)
export const refreshGithubToken = registry.refreshGithubToken.bind(registry)
export const send = registry.send.bind(registry)
export const abort = registry.abort.bind(registry)
export const releaseSession = async (
  sessionId: string
): Promise<void> => {
  registry.releaseSession(sessionId)
}
export const setModelSelection = registry.setModelSelection.bind(registry)
export const setRepoSource = registry.setRepoSource.bind(registry)
export const setThinkingLevel = registry.setThinkingLevel.bind(registry)
```

### Step 2: Add `WorkerMode` type ✅

**`src/agent/runtime-worker-types.ts`** — add at the top:

```ts
export type WorkerMode = "shared" | "dedicated"
```

Full file after edit:

```ts
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { RepoSource } from "@/types/storage"

export type WorkerMode = "shared" | "dedicated"

export type RuntimeCommandError = "busy" | "missing-session"

export interface RuntimeMutationResult {
  error?: RuntimeCommandError
  ok: boolean
}

export interface RuntimeWorkerApi {
  abort(sessionId: string): Promise<void>
  ensureSession(sessionId: string): Promise<boolean>
  refreshGithubToken(sessionId: string): Promise<RuntimeMutationResult>
  releaseSession(sessionId: string): Promise<void>
  send(sessionId: string, content: string): Promise<RuntimeMutationResult>
  setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<RuntimeMutationResult>
  setRepoSource(
    sessionId: string,
    repoSource?: RepoSource
  ): Promise<RuntimeMutationResult>
  setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<RuntimeMutationResult>
}
```

### Step 3: Rewrite `runtime-client.ts` ✅

This is the core change. Replace the hard gate with a feature-detection fallback.

**`src/agent/runtime-client.ts`**:

```ts
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { RepoSource } from "@/types/storage"
import type {
  RuntimeMutationResult,
  RuntimeWorkerApi,
  WorkerMode,
} from "@/agent/runtime-worker-types"

type WorkerModule = typeof import("./runtime-worker")

const sharedWorkerSupported =
  typeof window !== "undefined" && "SharedWorker" in window

function createWorkerApi(): { api: RuntimeWorkerApi; mode: WorkerMode } {
  if (typeof window === "undefined") {
    throw new Error("Worker runtime requires a browser environment")
  }

  const workerUrl = new URL("./runtime-worker", import.meta.url)
  const workerOpts = { name: "gitinspect-runtime", type: "module" as const }

  if (sharedWorkerSupported) {
    return {
      api: new ComlinkSharedWorker<WorkerModule>(workerUrl, workerOpts),
      mode: "shared",
    }
  }

  return {
    api: new ComlinkWorker<WorkerModule>(workerUrl, workerOpts),
    mode: "dedicated",
  }
}

/** Which worker mode the runtime connected with. Available after first ensureConnected(). */
export let workerMode: WorkerMode | undefined

export class RuntimeClient {
  private api?: RuntimeWorkerApi
  private connectError?: Error
  private connectPromise?: Promise<void>

  async ensureConnected(): Promise<void> {
    if (this.connectPromise) {
      return await this.connectPromise
    }

    if (this.connectError) {
      throw this.connectError
    }

    this.connectPromise = (async () => {
      const result = createWorkerApi()
      this.api = result.api
      workerMode = result.mode
    })().catch((error) => {
      this.connectError =
        error instanceof Error ? error : new Error(String(error))
      this.connectPromise = undefined
      throw error
    })

    return await this.connectPromise
  }

  async ensureSession(sessionId: string): Promise<boolean> {
    await this.ensureConnected()
    return (await this.api?.ensureSession(sessionId)) ?? false
  }

  async send(sessionId: string, content: string): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.send(sessionId, content)) ?? {
      error: "missing-session",
      ok: false,
    }
  }

  async abort(sessionId: string): Promise<void> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    await this.api?.abort(sessionId)
  }

  async releaseSession(sessionId: string): Promise<void> {
    await this.ensureConnected()
    await this.api?.releaseSession(sessionId)
  }

  async refreshGithubToken(
    sessionId: string
  ): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.refreshGithubToken(sessionId)) ?? {
      error: "missing-session",
      ok: false,
    }
  }

  async setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.setModelSelection(
      sessionId,
      providerGroup,
      modelId
    )) ?? {
      error: "missing-session",
      ok: false,
    }
  }

  async setRepoSource(
    sessionId: string,
    repoSource?: RepoSource
  ): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.setRepoSource(sessionId, repoSource)) ?? {
      error: "missing-session",
      ok: false,
    }
  }

  async setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<RuntimeMutationResult> {
    await this.ensureConnected()
    await this.ensureSession(sessionId)
    return (await this.api?.setThinkingLevel(sessionId, thinkingLevel)) ?? {
      error: "missing-session",
      ok: false,
    }
  }
}

export const runtimeClient = new RuntimeClient()
```

### Step 4: Update the audit test ✅

**`tests/runtime-audit.test.ts`** — update the file list:

```ts
const files = [
  "src/agent/runtime.ts",
  "src/agent/provider-stream.ts",
  "src/agent/runtime-client.ts",
  "src/agent/runtime-worker.ts",       // was runtime-shared-worker.ts
  "src/hooks/use-runtime-session.ts",
  "src/components/app-shell-page.tsx",
  "src/sessions/session-actions.ts",
  "src/auth/popup-flow.ts",
]
```

### Step 5: Delete the old file ✅

Remove `src/agent/runtime-shared-worker.ts` after creating `src/agent/runtime-worker.ts`.

---

## Why this works

### `vite-plugin-comlink` type parity

From `client.d.ts` in `vite-plugin-comlink`:

```ts
var ComlinkWorker: {
    new<T = any>(scriptURL: URL, options?: ComlinkWorkerOptions): { readonly [sym]: Worker } & Remote<T>;
};

var ComlinkSharedWorker: {
    new<T = any>(scriptURL: URL, options?: ComlinkWorkerOptions): { readonly [sym]: SharedWorker } & Remote<T>;
};
```

Both constructors return `Remote<T>` — the Comlink proxy interface. The only difference is the underlying `[endpointSymbol]` property type (`Worker` vs `SharedWorker`), which `RuntimeClient` never accesses. So the API is identical from the caller's perspective.

### Worker entry file is already mode-agnostic

`runtime-worker.ts` (née `runtime-shared-worker.ts`) exports plain functions. It never touches `self.onconnect` or any SharedWorker-specific global — `vite-plugin-comlink` handles the Comlink `expose()` call and connection wiring internally via its Vite transform. The same file works for both `ComlinkWorker` and `ComlinkSharedWorker` without modification.

### Vite bundles the worker correctly

Vite recognizes both `new Worker(new URL(...))` and `new SharedWorker(new URL(...))` patterns (and by extension `ComlinkWorker` / `ComlinkSharedWorker` which the plugin transforms into those). Both paths get their own chunk in the production build.

---

## What doesn't change

- **`SessionRuntimeRegistry`** — unchanged, runs inside the worker as before.
- **`AgentHost`** — unchanged, runs inside the worker as before.
- **`useRuntimeSession` hook** — unchanged, calls `runtimeClient` methods that work identically in both modes.
- **`session-actions.ts`** — unchanged, calls `runtimeClient.releaseSession`.
- **`app-shell-page.tsx`** — unchanged, uses the same `runtimeClient` import.
- **Dexie/IndexedDB persistence** — unchanged, all session data is persisted locally regardless of worker type.
- **Build config (`vite.config.ts`)** — unchanged, `comlink()` plugin already handles both worker types.
- **Tests that mock `runtimeClient`** — unchanged, the mock shape hasn't changed.

---

## Edge cases

### Two tabs, dedicated worker mode

Each tab runs its own `SessionRuntimeRegistry`. If both tabs open the same session and one sends a message, the other tab won't see the streaming state until it re-reads from Dexie (which `useLiveQuery` already does). This is acceptable degradation — session data is never lost, just not cross-tab synchronized in real time.

### Worker constructor fails

If `Worker` itself is unavailable (e.g. SSR, non-browser env), `createWorkerApi()` already throws on the `typeof window === "undefined"` check. No change needed.

### Future: adding real cross-tab sync for dedicated mode

If cross-tab coordination becomes important, `BroadcastChannel` (supported everywhere including Chrome Android) could be added later to notify other tabs of session state changes. This is out of scope for this change.

---

## Verification checklist

- [x] `bun run build` succeeds — Vite produces separate chunks for the worker in both modes
- [x] `bun run test` passes — audit test updated, mocked tests unaffected (125/125)
- [x] `bun run typecheck` passes — `ComlinkWorker` and `ComlinkSharedWorker` types both resolve
- [ ] Desktop browser (Chrome/Firefox/Safari): worker mode is `"shared"`, cross-tab works as before
- [ ] Chrome Android (or Chrome DevTools mobile emulation with `SharedWorker` disabled): worker mode is `"dedicated"`, chat works, single-tab experience is correct
- [ ] Open two tabs on desktop: both attach to same shared worker, sessions coordinate
- [ ] Open two tabs on mobile: each gets its own worker, sessions load independently from Dexie
