# Session State Migration Refactor Plan

## Summary

Refactor session persistence so the app no longer performs **write-on-read** repair from the chat load path.

### Problem

The current UI path is:

- `packages/ui/src/components/chat.tsx`
  - `useLiveQuery(async () => loadSessionViewModel(sessionId))`
- `packages/pi/src/sessions/session-view-model.ts`
  - `loadSessionViewModel()` calls `loadSessionWithMessages(sessionId)`
- `packages/pi/src/sessions/session-service.ts`
  - `loadSessionWithMessages()` sometimes sanitizes and **persists** repaired state

That is why some sessions throw:

> `Readwrite transaction in liveQuery context`

Only the sessions that need repair hit the write path.

### Goal

Move **as much repair as possible into a Dexie `version(6)` migration**, and make every session reader pure so it is always safe inside `liveQuery()`.

### Final architecture

After this refactor:

- `loadSession()` is read-only
- `loadSessionWithMessages()` is read-only
- `loadSessionViewModel()` is read-only
- legacy persisted conversation repair happens mostly once in Dexie `version(6)`
- a small **pure fallback normalizer** remains for imported or corrupted data that appears after migration

### Final persisted contract

After migration, the DB should satisfy these invariants:

- transcript history lives in `messages`
- partial assistant drafts live in `session_runtime.streamMessage`
- `messages` should not contain persisted `status: "streaming"` rows
- message `order` is dense per session starting at `0`
- tool results are linked to the correct assistant when deterministically recoverable
- session snapshot fields are rebuilt from normalized data:
  - `messageCount`
  - `preview`
  - `title`
  - `usage`
  - `cost`
  - `isStreaming`

---

## Context

Read the following files **in order** before making changes. This is all the context needed.

### 1) UI load path

1. `packages/ui/src/components/chat.tsx`
   - find the `useLiveQuery()` that loads the selected session
   - this is the user-facing call site that currently trips the Dexie error

2. `packages/pi/src/sessions/session-view-model.ts`
   - see how `loadSessionViewModel()` builds the view model from loaded session data

### 2) Current repair-on-read implementation

3. `packages/pi/src/sessions/session-service.ts`
   - read these functions carefully:
     - `normalizeSessionProviderGroup(...)`
     - `buildPersistedSession(...)`
     - `sanitizeLegacySession(...)`
     - `replaceSanitizedSessionState(...)`
     - `loadSessionWithMessages(...)`
   - this file currently mixes pure normalization with persistence side effects

4. `packages/pi/src/agent/tool-result-linker.ts`
   - this is the deterministic linker used to repair `parentAssistantId`
   - the migration should reuse this behavior through a shared pure normalizer

### 3) DB schema + runtime normalization

5. `packages/db/src/schema.ts`
   - read the existing Dexie versions `1` through `5`
   - inspect current migrations and all conversation helpers
   - note that `version(4)` and `version(5)` already perform deterministic repair

6. `packages/db/src/session-runtime.ts`
   - read `normalizeSessionRuntime(...)`
   - note that this file currently mixes pure normalization with mutation helpers that write via `schema.ts`

7. `packages/db/src/storage-types.ts`
   - read the contracts for:
     - `SessionData`
     - `MessageRow`
     - `SessionRuntimeRow`
     - `SessionRuntimeStatus`
     - `RuntimePhase`

### 4) Normal write-path contract

8. `packages/pi/src/agent/turn-event-store.ts`
   - this shows the intended current persisted conversation shape during normal runtime writes
   - use this file as the source of truth for how completed transcript rows and runtime state should look after migration

### 5) Tests that must change or be used as patterns

9. `tests/session-service-legacy-sanitize.test.ts`
   - this currently tests the old write-on-read behavior
   - these tests must be rewritten to assert **read-only normalization**

10. `tests/db-schema.test.ts`

- use the existing migration tests here as the pattern for writing the new v6 migration tests

11. `tests/session-view-model.test.ts`

- verifies view-model projection behavior after session loading

12. `tests/chat-state.test.tsx`

- use this file as the place to add the regression test for opening a dirty session through the actual chat load path without throwing

### Optional sanity checks after reading the above

- `package.json`
  - test command is `bun run test`
  - typecheck command is `bun run check-types`

---

## Locked decisions / constraints

These are not open questions during implementation.

- **No `load*()` reader may write to IndexedDB.**
- **Move deterministic persisted repair into Dexie `version(6)`.**
- **Keep a pure read-time fallback normalizer** for stale/imported current-schema rows.
- **Do not import `session-service.ts` into `schema.ts`.** Shared logic must be extracted into pure cycle-free modules.
- **Do not change the store layout or indexes in this refactor unless strictly required.** `version(6)` should reuse the `version(5)` store definitions.
- **Migration may not depend on lease state or active-tab ownership.** Dexie upgrade runs with exclusive DB access, so it should only use persisted rows.
- **Keep timestamps stable where possible.** Do not churn `createdAt` / `updatedAt` unless required to synthesize a missing runtime row.
- **Choose a deterministic policy for multiple persisted transcript `status: "streaming"` assistant rows:** keep the latest/highest-order assistant draft as the recovered `streamMessage`, and remove all transcript streaming rows.
- **Tool-result repair policy:**
  - if `parentAssistantId` can be derived deterministically, persist it
  - if a tool result is orphaned and cannot be linked, drop it from the normalized transcript
- **Do not keep the old `persistSanitized` option.** Remove it entirely.

---

## Required new pure modules

Use these exact file names unless a very strong reason appears during implementation.

### `packages/db/src/session-runtime-normalization.ts` (new)

Create a pure module that contains only runtime normalization helpers.

Required exports:

```ts
export function derivePhaseFromStatus(status: SessionRuntimeStatus | undefined): RuntimePhase;

export function deriveStatusFromPhase(
  phase: RuntimePhase,
  current: SessionRuntimeRow | undefined,
): SessionRuntimeStatus;

export function normalizeSessionRuntime(
  sessionId: string,
  runtime: SessionRuntimeRow | undefined,
): SessionRuntimeRow | undefined;
```

Rules:

- no imports from `schema.ts`
- no writes
- mutation helpers in `packages/db/src/session-runtime.ts` should import from this new file after extraction

### `packages/pi/src/sessions/session-state-normalization.ts` (new)

Create a pure module that holds the shared session normalization logic used by both:

- Dexie migration `version(6)`
- read-time fallback normalization in `loadSessionWithMessages()`

Required export shape:

```ts
export function normalizePersistedSessionState(input: {
  session: SessionData;
  messages: MessageRow[];
  runtime?: SessionRuntimeRow;
  options?: {
    allowInterruptedHydration?: boolean;
    now?: string;
  };
}): {
  changed: boolean;
  deletedMessageIds: string[];
  messages: MessageRow[];
  runtime?: SessionRuntimeRow;
  session: SessionData;
};
```

This module should own or re-export the pure helpers currently embedded in `session-service.ts`, including:

- session provider-group normalization
- order normalization
- transcript/runtime contract normalization
- tool-result relinking
- session snapshot rebuild

Rules:

- no imports from `db/schema.ts`
- no writes
- may import `tool-result-linker.ts`
- may import the new `session-runtime-normalization.ts`

---

## Detailed todo list

Follow these phases in order.

---

## Phase 0 — Read and confirm the current behavior

- [ ] Read every file listed in the **Context** section in the order shown.
- [ ] Confirm the current bug path:
  - `Chat.tsx` uses `useLiveQuery()`
  - `useLiveQuery()` calls `loadSessionViewModel()`
  - `loadSessionViewModel()` calls `loadSessionWithMessages()`
  - `loadSessionWithMessages()` can currently write via `replaceSanitizedSessionState()`
- [ ] Confirm there are no external callers that still rely on the `persistSanitized` option.
- [ ] Confirm the intended persisted shape from `TurnEventStore`:
  - completed transcript rows in `messages`
  - partial draft in `session_runtime.streamMessage`
  - no need for transcript `status: "streaming"` rows in the final contract

---

## Phase 1 — Extract pure runtime normalization

- [ ] Create `packages/db/src/session-runtime-normalization.ts`.
- [ ] Move the pure runtime helpers out of `packages/db/src/session-runtime.ts` into the new file:
  - `derivePhaseFromStatus(...)`
  - `deriveStatusFromPhase(...)`
  - `normalizeSessionRuntime(...)`
- [ ] Update `packages/db/src/session-runtime.ts` to import those helpers from the new pure module.
- [ ] Verify the new pure runtime module has **no** imports from `schema.ts` and no write helpers.
- [ ] Run typecheck after this extraction before doing more refactors.

---

## Phase 2 — Extract shared pure session normalization

- [ ] Create `packages/pi/src/sessions/session-state-normalization.ts`.
- [ ] Move or recreate the following pure helpers in that file:
  - `normalizeSessionProviderGroup(...)`
  - `buildPersistedSession(...)`
  - deterministic message sorting / dense-order assignment
  - legacy transcript/runtime normalization logic
- [ ] Reuse `linkToolResults(...)` from `packages/pi/src/agent/tool-result-linker.ts` for deterministic tool-result repair.
- [ ] Implement a single pure `normalizePersistedSessionState(...)` function that returns:
  - `changed`
  - `deletedMessageIds`
  - normalized `messages`
  - normalized `runtime`
  - normalized `session`
- [ ] Implement the normalization rules inside `normalizePersistedSessionState(...)`:
  - [ ] normalize provider group + canonical provider
  - [ ] normalize runtime phase/status
  - [ ] sort messages deterministically
  - [ ] assign dense `order`
  - [ ] split `streaming` transcript rows from completed transcript rows
  - [ ] choose the latest/highest-order assistant streaming row as the recovered draft
  - [ ] remove all transcript `status: "streaming"` rows from returned normalized transcript
  - [ ] run tool-result relinking on the completed transcript
  - [ ] drop unresolvable orphan tool results
  - [ ] if `allowInterruptedHydration === true` and a recovered assistant draft exists:
    - [ ] create a missing interrupted runtime row, or
    - [ ] attach `streamMessage` to an existing runtime row that lacks it
  - [ ] if `allowInterruptedHydration === false`, keep the transcript normalized in memory but do **not** synthesize an interrupted runtime row from streaming transcript rows
  - [ ] rebuild the session snapshot from the normalized transcript/runtime state
- [ ] Keep the function pure:
  - no `db.*`
  - no transactions
  - no writes
- [ ] Keep timestamp churn controlled:
  - use `options.now` only when synthesizing a missing runtime row
  - otherwise preserve persisted timestamps where possible
- [ ] Ensure this new module does not import `schema.ts`.
- [ ] Run typecheck after extraction.

---

## Phase 3 — Add Dexie `version(6)` migration

- [ ] In `packages/db/src/schema.ts`, add a new `version(6)`.
- [ ] Reuse the exact same `.stores({...})` definition as `version(5)` unless a hard technical reason appears to change it.
- [ ] In the `version(6).upgrade(async (tx) => { ... })` callback, read:
  - `sessions`
  - `messages`
  - `session_runtime`
- [ ] Group message rows by `sessionId`.
- [ ] For each persisted session row:
  - [ ] fetch its grouped messages
  - [ ] fetch its runtime row
  - [ ] call `normalizePersistedSessionState({ ... })` with:
    - `allowInterruptedHydration: true`
    - a stable migration `now` timestamp for synthesized runtime rows
- [ ] Persist the normalized result for each session:
  - [ ] `bulkPut()` normalized messages that remain
  - [ ] `bulkDelete()` `deletedMessageIds`
  - [ ] `put()` normalized session
  - [ ] `put()` normalized runtime when one exists
  - [ ] `delete()` runtime row when the normalized result has no runtime and one existed before
- [ ] Add one explicit orphan cleanup policy in the migration:
  - [ ] delete `session_runtime` rows whose `sessionId` no longer exists in `sessions`
  - [ ] do **not** add any broader destructive cleanup beyond this in the first implementation
- [ ] Do **not** read lease state in the migration.
- [ ] Do **not** import `session-service.ts` into `schema.ts`.
- [ ] Ensure the migration only uses the new pure normalizer and table handles from `tx`.

---

## Phase 4 — Refactor session readers to be pure

- [ ] Update `packages/pi/src/sessions/session-service.ts` to use the new shared pure normalizer.
- [ ] Remove `replaceSanitizedSessionState(...)` completely.
- [ ] Remove the `persistSanitized` option from `loadSessionWithMessages(...)` completely.
- [ ] Replace any remaining write-on-read behavior with a pure in-memory normalization result.
- [ ] Preserve the existing public behavior of `loadSessionWithMessages(...)` as much as possible, except for removing persistence side effects.
- [ ] Keep the read-time fallback logic:
  - [ ] read lease state if needed to decide `allowInterruptedHydration`
  - [ ] call `normalizePersistedSessionState(...)`
  - [ ] return the normalized result
  - [ ] never write
- [ ] Keep `loadSession()` read-only.
- [ ] Keep `loadSessionViewModel()` read-only.
- [ ] Confirm `packages/ui/src/components/chat.tsx` does not need structural change once the underlying loader is pure.
- [ ] Run typecheck after this phase.

---

## Phase 5 — Rewrite and add tests

### A. Migration tests

Add migration tests to `tests/db-schema.test.ts` using the same legacy-DB pattern already present there.

- [ ] Add test: transcript streaming row migrates into interrupted runtime
  - legacy setup:
    - one session
    - one completed user message with bad order
    - one assistant transcript row with `status: "streaming"`
    - no runtime row
  - expect after opening migrated DB:
    - transcript only contains the completed user row
    - user row order is `0`
    - runtime row exists
    - runtime row is interrupted
    - runtime row contains the recovered `streamMessage`
    - session snapshot fields are normalized
    - session `isStreaming === false`

- [ ] Add test: existing runtime row gets missing `streamMessage` attached
  - legacy setup:
    - session has runtime row
    - transcript still contains a legacy streaming assistant row
    - runtime row lacks `streamMessage`
  - expect:
    - transcript streaming row is removed
    - runtime row is preserved
    - recovered draft is attached to `streamMessage`

- [ ] Add test: tool-result relinking is persisted by migration
  - legacy setup:
    - assistant message with tool call
    - tool result missing `parentAssistantId`
  - expect:
    - migrated tool result has correct `parentAssistantId`
    - transcript order is dense

- [ ] Add test: orphan tool-result rows are dropped by migration
  - legacy setup:
    - tool result references a non-existent tool call
  - expect:
    - tool-result row is removed

- [ ] Add test: provider-group normalization is persisted by migration
  - legacy setup:
    - session missing `providerGroup`
  - expect:
    - migrated session has normalized `providerGroup`
    - `provider` matches the canonical provider for that group

- [ ] Add test: multiple transcript streaming assistant rows keep the latest one only
  - legacy setup:
    - two or more assistant transcript rows with `status: "streaming"`
  - expect:
    - all transcript streaming rows are removed
    - recovered runtime draft comes from the latest/highest-order assistant row

### B. Read-only fallback tests

Update `tests/session-service-legacy-sanitize.test.ts` to reflect the new boundary.

- [ ] Remove the expectation that `loadSessionWithMessages()` writes back repaired state.
- [ ] Add/replace with a test that inserts dirty rows directly into the **current** schema and verifies:
  - [ ] `loadSessionWithMessages()` returns normalized in-memory session/messages/runtime
  - [ ] persisted DB rows remain unchanged after the read
  - [ ] no runtime row is written by the reader
- [ ] Keep or update the active-lease case so the fallback remains read-only and does not synthesize interrupted runtime when `allowInterruptedHydration` should be false.

### C. View-model and UI regression tests

- [ ] Update `tests/session-view-model.test.ts` only if necessary to match the refactor.
- [ ] Add a regression test in `tests/chat-state.test.tsx` for the original bug:
  - create a dirty current-schema session that would previously trigger repair
  - render the chat component on that session
  - assert the load succeeds without throwing `Readwrite transaction in liveQuery context`

---

## Phase 6 — Verify and clean up

- [ ] Search the repo for `persistSanitized` and confirm it is gone.
- [ ] Search the repo for `replaceSanitizedSessionState` and confirm it is gone.
- [ ] Search for any remaining session load helper that performs writes and remove or justify it.
- [ ] Ensure new pure modules have no accidental imports from `schema.ts`.
- [ ] Run targeted tests:
  - `bunx vitest run tests/db-schema.test.ts tests/session-service-legacy-sanitize.test.ts tests/session-view-model.test.ts tests/chat-state.test.tsx`
- [ ] Run the full test suite:
  - `bun run test`
- [ ] Run typecheck:
  - `bun run check-types`
- [ ] If typecheck or tests fail, fix them before considering the refactor done.

---

## Definition of done

This plan is complete only when all of the following are true:

- opening a dirty legacy session through `Chat.tsx` no longer throws `Readwrite transaction in liveQuery context`
- `loadSessionWithMessages()` performs zero writes
- the old write-on-read repair path has been deleted
- most deterministic repair happens once in Dexie `version(6)`
- read-time fallback normalization remains pure and covered by tests
- migration tests cover transcript streaming repair, tool-result relinking, provider-group normalization, and multiple-streaming-row policy
- full tests and typecheck pass

---

## Non-goals

Do not expand scope beyond this plan.

- do not redesign session leases
- do not redesign runtime ownership
- do not redesign the chat component structure
- do not add new stores or indexes unless strictly required
- do not introduce a background repair service in this refactor
- do not implement product behavior changes unrelated to session persistence
