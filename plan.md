# Runtime Error Simplification Plan

Date: 2026-03-26

Goal:

- remove `RuntimeMutationResult`
- replace stringly `{ ok, error }` mutation wrappers with typed thrown errors
- simplify runtime mutation flow without rewriting the agent/runtime around `better-result`

Decision:

- do **not** rewrite the runtime with `better-result`
- use typed thrown errors instead

Reason:

- the remaining complexity is lifecycle/persistence/worker coordination
- `better-result` would add more transport machinery here than value
- the real simplification target is the mutation error round-trip

Current problem:

```ts
const result = await runtimeClient.send(currentSessionId, content)

if (!result.ok) {
  throw new Error(result.error ?? "missing-session")
}
```

That pattern exists because:

- registry returns `{ ok, error }`
- client forwards `{ ok, error }`
- UI unwraps and rethrows generic `Error`

This should become:

```ts
await runtimeClient.send(currentSessionId, content)
```

with typed domain errors thrown from below.

---

## Status

Legend:

- `[ ]` not started
- `[~]` in progress
- `[x]` completed

Checklist:

- [x] Phase 1. Add typed runtime command errors
- [x] Phase 2. Remove `RuntimeMutationResult` from worker/runtime APIs
- [x] Phase 3. Make registry and client throw/revive typed errors
- [x] Phase 4. Remove unwrap/rethrow boilerplate in UI and actions
- [x] Phase 5. Update tests and validate with typecheck + full test suite

---

## Target shape

```text
UI / session-actions
  -> RuntimeClient
    -> worker RPC
      -> SessionRuntimeRegistry
        -> AgentHost
```

Error flow after cleanup:

```text
SessionRuntimeRegistry throws BusyRuntimeError | MissingSessionRuntimeError
  -> RuntimeClient rethrows
    -> UI maps typed error to user-facing string once
```

---

## Exact implementation

### 1. Add typed runtime command errors

Create:

- `src/agent/runtime-command-errors.ts`

```ts
export abstract class RuntimeCommandError extends Error {
  abstract readonly code: "busy" | "missing-session"
}

export class MissingSessionRuntimeError extends RuntimeCommandError {
  readonly code = "missing-session" as const

  constructor(sessionId: string) {
    super(`Missing runtime session: ${sessionId}`)
    this.name = "MissingSessionRuntimeError"
  }
}

export class BusyRuntimeError extends RuntimeCommandError {
  readonly code = "busy" as const

  constructor(sessionId: string) {
    super(`Runtime session is busy: ${sessionId}`)
    this.name = "BusyRuntimeError"
  }
}

export function getRuntimeCommandErrorMessage(error: unknown): string {
  if (error instanceof BusyRuntimeError) {
    return "This session is already streaming."
  }

  if (error instanceof MissingSessionRuntimeError) {
    return "This session could not be loaded from local storage."
  }

  if (error instanceof Error) {
    return error.message
  }

  return "Runtime request failed"
}
```

### 2. Delete `RuntimeMutationResult`

Update:

- `src/agent/runtime-worker-types.ts`

Delete:

- `RuntimeCommandError` string union
- `RuntimeMutationResult`

Target:

```ts
export interface RuntimeWorkerApi {
  abort(sessionId: string): Promise<void>
  ensureSession(sessionId: string): Promise<boolean>
  refreshGithubToken(sessionId: string): Promise<void>
  releaseSession(sessionId: string): Promise<void>
  send(sessionId: string, content: string): Promise<void>
  setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void>
  setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<void>
}
```

### 3. Make registry throw typed errors

Update:

- `src/agent/session-runtime-registry.ts`

Replace mutation wrapper logic with:

```ts
private async getHostForCommand(
  sessionId: string,
  options: { requireIdle?: boolean } = {}
): Promise<AgentHost> {
  const host = await this.getOrCreateHost(sessionId)

  if (!host) {
    throw new MissingSessionRuntimeError(sessionId)
  }

  if (options.requireIdle && host.isBusy()) {
    throw new BusyRuntimeError(sessionId)
  }

  return host
}
```

Then mutation methods become:

```ts
async send(sessionId: string, content: string): Promise<void> {
  const host = await this.getHostForCommand(sessionId, { requireIdle: true })
  await host.prompt(content)
}

async setThinkingLevel(
  sessionId: string,
  thinkingLevel: ThinkingLevel
): Promise<void> {
  const host = await this.getHostForCommand(sessionId, { requireIdle: true })
  await host.setThinkingLevel(thinkingLevel)
}
```

Keep:

- `ensureSession(): Promise<boolean>`
- `releaseSession()`
- `abort()` bypassing idle checks

### 4. Simplify runtime client to pass-through

Update:

- `src/agent/runtime-client.ts`

Delete:

- `callSessionMutation()`

Replace with:

```ts
private async callSession(
  sessionId: string,
  invoke: (api: RuntimeWorkerApi) => Promise<void>
): Promise<void> {
  await this.call(async (api) => {
    const exists = await api.ensureSession(sessionId)

    if (!exists) {
      throw new MissingSessionRuntimeError(sessionId)
    }

    await invoke(api)
  })
}
```

Then:

```ts
async send(sessionId: string, content: string): Promise<void> {
  await this.callSession(sessionId, async (api) => {
    await api.send(sessionId, content)
  })
}
```

Important:

- if worker/registry already throws `MissingSessionRuntimeError`, just rethrow it
- client should stop manufacturing wrapper objects

### 5. Delete unwrap/rethrow boilerplate in UI and actions

Update:

- `src/hooks/use-runtime-session.ts`
- `src/sessions/session-actions.ts`
- `src/components/settings-dialog.tsx`

Replace:

```ts
const result = await runtimeClient.send(currentSessionId, content)

if (!result.ok) {
  throw new Error(result.error ?? "missing-session")
}
```

With:

```ts
await runtimeClient.send(currentSessionId, content)
```

Replace:

```ts
getRuntimeActionErrorMessage(error: Error | undefined)
```

With:

```ts
getRuntimeCommandErrorMessage(error: unknown)
```

For `createSessionAndSend()` keep rollback:

```ts
try {
  await runtimeClient.send(session.id, params.content)
} catch (error) {
  await deleteSession(session.id)
  throw error
}
```

### 6. Update tests

Update:

- `tests/runtime-client.test.ts`
- `tests/session-runtime-registry.test.ts`
- `tests/session-actions.test.ts`

Change assertions from wrapper shape:

```ts
await expect(client.send("missing", "hello")).resolves.toEqual({
  error: "missing-session",
  ok: false,
})
```

To typed thrown behavior:

```ts
await expect(client.send("missing", "hello")).rejects.toMatchObject({
  code: "missing-session",
})
```

And:

```ts
await expect(registry.send(session.id, "hello")).rejects.toMatchObject({
  code: "busy",
})
```

---

## Files touched

- `src/agent/runtime-command-errors.ts` new
- `src/agent/runtime-worker-types.ts`
- `src/agent/session-runtime-registry.ts`
- `src/agent/runtime-client.ts`
- `src/hooks/use-runtime-session.ts`
- `src/sessions/session-actions.ts`
- `src/components/settings-dialog.tsx`
- `tests/runtime-client.test.ts`
- `tests/session-runtime-registry.test.ts`
- `tests/session-actions.test.ts`

---

## Why this improves the code

### `runtime-client`

Before:

- returns mutation wrapper objects
- wrapper objects only exist to be unpacked immediately above

After:

- mutation methods become `Promise<void>`
- file loses fallback/result boilerplate

### `session-runtime-registry`

Before:

- host lookup and transport result construction are mixed

After:

- host lookup returns a host or throws
- mutation methods become straight-line imperative code

### `use-runtime-session`

Before:

- each mutation converts a wrapper result into thrown `Error`

After:

- hook only maps typed domain errors to strings
- no duplicate unwrap/rethrow blocks

### tests

Before:

- tests assert transport shape

After:

- tests assert domain behavior
- missing session and busy session become first-class failures

---

## Why not `better-result`

For this runtime, `better-result` is the wrong scope.

It would not simplify:

- stream orchestration
- persistence queueing
- worker lifecycle
- agent event handling

It would only replace one error transport shape with another.

Typed thrown errors are the smaller, sharper change.

---

## Validation

After implementation:

1. run `bun run typecheck`
2. run `bun run test -- tests/runtime-client.test.ts tests/session-runtime-registry.test.ts tests/session-actions.test.ts`
3. run `bun run test`

---

## Success criteria

- no `RuntimeMutationResult` remains
- no `{ ok, error }` mutation wrappers remain
- no `throw new Error(result.error ?? ...)` remains
- UI still shows the same user-facing busy/missing-session messages
- tests pass
