# Agent Runtime Research

Date: 2026-03-26

Scope:
- `src/agent/*`
- runtime call sites in `src/components/chat.tsx`, `src/hooks/use-runtime-session.ts`, `src/sessions/session-actions.ts`
- Sitegeist reference in `docs/sitegeist/src/sidepanel.ts`, `docs/sitegeist/src/messages/message-transformer.ts`, `docs/sitegeist/src/storage/*`, `docs/sitegeist/docs/*`

Method:
- read current runtime code end-to-end
- read Sitegeist runtime/storage/proxy code end-to-end
- grep imports/usages to find stale surfaces
- run focused tests:

```sh
bun run test -- tests/provider-stream.test.ts tests/message-transformer.test.ts tests/runtime-audit.test.ts tests/agent-host-persistence.test.ts
```

Result: 9/9 tests passed.

---

## TL;DR

Short version:

- current runtime is **not just overengineered for no reason**
- biggest justified difference vs Sitegeist: **worker-hosted per-session runtime + Dexie-driven UI reactivity**
- biggest accidental complexity: **too much logic collapsed into `AgentHost` + repeated wrapper layers around it**
- biggest clear dead/stale surfaces:
  - `src/agent/runtime.ts`
  - `src/agent/live-runtime.ts`
  - `toOpenAIChatMessages()` in `src/agent/message-transformer.ts`
  - `toAnthropicMessages()` in `src/agent/message-transformer.ts`
  - `setRepoSource()` path appears unused end-to-end
  - `WorkerMode` / returned `mode` in `src/agent/runtime-client.ts`

Net:

- architecture direction mostly correct
- implementation can be simplified materially
- main target: split persistence/orchestration from `AgentHost`, collapse wrapper boilerplate, delete stale seams

---

## 1. How current runtime works

### 1.1 Actual flow

Current app flow:

1. UI loads session from Dexie via `useLiveQuery`
2. UI sends mutation through `runtimeClient`
3. `runtimeClient` connects to `SharedWorker` if supported, else `Worker`
4. worker exports registry methods from `SessionRuntimeRegistry`
5. registry lazily loads session + messages from Dexie and creates one `AgentHost` per session
6. `AgentHost` owns the real `Agent`, tool injection, persistence, cost aggregation, and local system notices
7. UI updates because Dexie rows change, not because UI subscribes to the `Agent` directly

Code path:

- UI send: `src/components/chat.tsx:281-290`
- UI runtime hook: `src/hooks/use-runtime-session.ts:18-117`
- client worker bridge: `src/agent/runtime-client.ts:40-145`
- worker exports: `src/agent/runtime-worker.ts:1-16`
- session host registry: `src/agent/session-runtime-registry.ts:10-239`
- host: `src/agent/agent-host.ts:42-637`

Key snippet:

```ts
// src/components/chat.tsx:281-289
const handleSend = React.useCallback(
  async (content: string) => {
    if (activeSession) {
      await runtime.send(content)
      return
    }

    await handleFirstSend(content)
  },
  [activeSession, handleFirstSend, runtime]
)
```

```ts
// src/agent/runtime-client.ts:19-37
if (sharedWorkerSupported) {
  const worker = new SharedWorker(
    new URL("./runtime-worker", import.meta.url),
    { name: "gitinspect-runtime", type: "module" }
  )
  return { api: wrap<RuntimeWorkerApi>(worker.port), mode: "shared" }
}

const worker = new Worker(
  new URL("./runtime-worker", import.meta.url),
  { name: "gitinspect-runtime", type: "module" }
)
return { api: wrap<RuntimeWorkerApi>(worker), mode: "dedicated" }
```

This is a real architectural difference from Sitegeist. It matters.

### 1.2 What `AgentHost` really owns

`AgentHost` is not a thin adapter. It owns:

- `Agent` construction
- model/auth resolution
- repo tool injection
- optimistic user row + streaming assistant placeholder persistence
- partial tool-result persistence during stream
- final session metadata derivation
- daily cost recording
- runtime error classification -> local system message append
- stream lifecycle cleanup / safety net

Evidence:

- construct agent: `src/agent/agent-host.ts:75-102`
- prompt optimistic persistence: `src/agent/agent-host.ts:108-223`
- model/thinking/repo mutations: `src/agent/agent-host.ts:230-294`
- event-driven persistence: `src/agent/agent-host.ts:397-538`
- system notices: `src/agent/agent-host.ts:599-636`

Size:

```txt
637 src/agent/agent-host.ts
239 src/agent/session-runtime-registry.ts
145 src/agent/runtime-client.ts
530 src/agent/provider-stream.ts
```

`AgentHost` is the main complexity center.

---

## 2. How Sitegeist does it

Sitegeist keeps the runtime much flatter:

- one sidepanel page owns one in-memory `Agent`
- sidepanel subscribes directly to `agent.subscribe(...)`
- session persistence happens from that subscription
- multi-window coordination is done with window-scoped locks in background worker, not with a shared runtime worker

Evidence:

- create agent: `docs/sitegeist/src/sidepanel.ts:329-403`
- persist on subscribe: `docs/sitegeist/src/sidepanel.ts:407-457`
- save session body: `docs/sitegeist/src/sidepanel.ts:244-321`
- multi-window lock design: `docs/sitegeist/docs/multi-window.md:1-213`
- background lock manager: `docs/sitegeist/src/background.ts:29-166`

Key Sitegeist snippet:

```ts
// docs/sitegeist/src/sidepanel.ts:381-403
agent = new Agent({
  initialState: initialState || {
    systemPrompt: SYSTEM_PROMPT,
    model: defaultModel,
    thinkingLevel: "medium",
    messages: [],
    tools: [],
  },
  convertToLlm: browserMessageTransformer,
  toolExecution: "sequential",
  streamFn: createStreamFn(async () => { ... }),
  getApiKey: async (provider: string) => { ... },
});
```

```ts
// docs/sitegeist/src/sidepanel.ts:407-457
agentUnsubscribe = agent.subscribe((event: AgentEvent) => {
  ...
  if (currentSessionId) {
    saveSession();
  }
  renderApp();
});
```

That is simpler. But also solves a different problem.

---

## 3. What is simpler here than Sitegeist

Important: not all current complexity is bloat. Some parts are already much simpler than Sitegeist.

### 3.1 Message transformer is dramatically smaller in scope

Sitegeist transformer:

- filters UI-only roles
- turns navigation events into injected user messages
- injects skills text
- reorders tool results

See `docs/sitegeist/src/messages/message-transformer.ts:75-123`.

Current transformer:

- keep only LLM-compatible roles
- reorder tool results after assistant tool calls

See `src/agent/message-transformer.ts:113-115`.

Current snippet:

```ts
export function webMessageTransformer(messages: AgentMessage[]): Message[] {
  return reorderMessages(messages.filter(isLlmMessage))
}
```

This is good. No browser-context injection. No nav messages. No extension-only junk. Matches `SPEC.md:106-112`.

### 3.2 Tool surface is much smaller

Sitegeist tool factory wires:

- navigate
- ask_user_which_element
- repl
- skill
- extract_document
- extract_image
- optional debugger

See `docs/sitegeist/src/sidepanel.ts:518-565`.

Current app only injects repo tools when a repo session exists:

- `read`
- `bash`

See `src/tools/index.ts:6-23`.

This is aligned with v0.

### 3.3 UI/runtime boundary is cleaner

Sitegeist UI directly owns the live `Agent`.

Current app UI only:

- reads Dexie
- sends mutations

This is cleaner for reload/resume. It is a real improvement, not bloat.

Evidence:

- UI reads Dexie: `src/components/chat.tsx:102-127`
- UI does not own `Agent`: no `new Agent(...)` outside `AgentHost`

---

## 4. What is more complex here than Sitegeist

### 4.1 Worker runtime layer

Current app adds:

- `RuntimeClient`
- worker module
- `SessionRuntimeRegistry`
- `AgentHost`

Sitegeist does not need these because the sidepanel page itself owns the runtime.

This added complexity is justified by product requirements:

- shared runtime across tabs when `SharedWorker` exists
- dedicated worker fallback otherwise
- sessions survive reloads
- UI can reconnect to persisted state through Dexie

Requirement source:

- `AGENTS.md:19`
- `SPEC.md:92-104`

Verdict:

- **justified**
- but currently over-abstracted in spots

### 4.2 Persistence is more robust, but much more bespoke

Sitegeist saves full session snapshots on subscription.

Current runtime persists much more incrementally:

- create user row
- create streaming assistant placeholder row
- persist tool results while stream still active
- write session boundary state separately
- aggregate cost once per assistant id
- append local system messages for repo/provider/runtime failures

Evidence:

- placeholder rows: `src/agent/agent-host.ts:155-175`
- persist tool results mid-stream: `src/agent/agent-host.ts:431-490`
- boundary persistence: `src/agent/agent-host.ts:493-538`
- dedupe cost writes: `src/agent/agent-host.ts:416-428`, `546-559`

This is not fake complexity. It adds robustness. Especially for repo-tool sessions.

### 4.3 Provider stream/proxy logic diverges from Sitegeist

Sitegeist proxy helper only proxies some providers:

- Z-AI always
- Anthropic OAuth tokens
- others direct

See `docs/pi-mono/packages/web-ui/src/utils/proxy-utils.ts:19-50`.

Current app proxies more aggressively:

```ts
// src/agent/provider-stream.ts:219-230
switch (provider.toLowerCase()) {
  case "anthropic":
    return apiKey.startsWith("sk-ant-oat") || apiKey.startsWith("{")
  case "openai":
  case "openai-codex":
  case "opencode":
  case "opencode-go":
    return true
  default:
    return false
}
```

This is a deliberate web-app adaptation, not obviously overengineering.

Reason:

- Sitegeist is an extension runtime
- this app is a normal browser tab
- CORS / backend-api access constraints differ

Evidence from tests:

- codex proxied: `tests/provider-stream.test.ts:80-163`
- google stays direct: `tests/provider-stream.test.ts:165-220`

Verdict:

- **do not simplify this toward Sitegeist blindly**
- this is one of the places where runtime environment actually matters

---

## 5. Current design strengths

These parts looked solid.

### 5.1 Dexie-as-source-of-truth is a good choice

UI state comes from Dexie, not from live `Agent` subscriptions. This means:

- reload-safe
- worker-safe
- easier eventual multi-tab consistency

Compared to Sitegeist:

- Sitegeist full session data + metadata live in separate stores
- current app uses `sessions` + `messages` + derived metadata fields in `sessions`

Current schema:

- `src/db/schema.ts:17-24`
- message/session split: `src/db/schema.ts:27-35`

Sitegeist schema reasoning:

- `docs/sitegeist/docs/storage.md:163-220`

My take:

- current `sessions` + `messages` split is sensible for streamed transcripts
- not having Sitegeist’s `sessions-metadata` store is okay because current `sessions` rows are already metadata-like, not full transcript blobs

So this part is simpler, not worse.

### 5.2 Error classification -> local system messages is useful

This is a net improvement for repo-backed chat UX.

Code:

- classify: `src/agent/runtime-errors.ts:45-161`
- append local message: `src/agent/agent-host.ts:599-636`
- UI render + CTA: `src/components/chat-message.tsx:74-145`

It keeps tool/provider failures inside transcript, but not in LLM context:

```ts
// src/agent/session-adapter.ts:104-109
export function toAgentMessages(messages: MessageRow[]): Message[] {
  return messages
    .filter((row) => row.role !== "system")
    .map((message) => toChatMessage(message) as Message)
}
```

That separation is clean.

### 5.3 Repo tools are injected only when runtime exists

```ts
// src/agent/agent-host.ts:575-583
private getAgentTools(runtime = this.repoRuntime) {
  if (!runtime) {
    return []
  }

  return createRepoTools(runtime, {
    onRepoError: (err) => this.appendSystemNoticeFromError(err),
  }).agentTools
}
```

Good:

- no repo tool noise in plain chat sessions
- aligns with `SPEC.md:106-112`

---

## 6. Real over-complexity / dead surface

This is the important section.

### 6.1 `AgentHost` is too big

`AgentHost` is 637 LOC. It currently mixes 5 concerns:

1. agent construction/config
2. runtime mutation API
3. transcript persistence
4. usage/cost dedupe
5. error notice translation

That makes it hard to reason about correctness.

Evidence of defensive complexity:

```ts
// src/agent/agent-host.ts:210-220
if (this.session.isStreaming) {
  console.warn(
    `[agent-host] Safety net: session ${this.session.id} still marked isStreaming after prompt resolved, forcing off`
  )
  this.session = {
    ...this.session,
    isStreaming: false,
    updatedAt: getIsoNow(),
  }
  await putSession(this.session)
  this.clearActiveStreamPointers()
}
```

This safety net may be prudent. But its existence is a smell: event ordering / persistence lifecycle is hard enough that host no longer trusts normal completion path.

Recommendation:

- split `AgentHost` into:
  - `SessionAgent` or `AgentController`: only wraps `Agent`
  - `SessionPersistence`: row writes + metadata derivation
  - `RuntimeNoticeService`: classify + dedupe system notices

### 6.2 Client + registry mutation APIs are copy-pasted

`RuntimeClient` repeats the same pattern for every method:

- `ensureConnected()`
- `ensureSession(sessionId)`
- call method
- fallback `{ ok: false, error: "missing-session" }`

`SessionRuntimeRegistry` repeats the same pattern too:

- `ensureSession(sessionId)`
- fetch host
- missing-session guard
- busy guard
- invoke method

Evidence:

- repeated client calls: `src/agent/runtime-client.ts:67-142`
- repeated registry guards: `src/agent/session-runtime-registry.ts:36-229`

`rg` count evidence:

- many repeated `await this.ensureConnected()`
- many repeated `const exists = await this.ensureSession(sessionId)`
- many repeated `const host = this.sessionHosts.get(sessionId)`

Recommendation:

- add one generic helper in client:

```ts
private async callSessionMutation<T extends keyof RuntimeWorkerApi>(...)
```

- add one generic helper in registry:

```ts
private async withHost(sessionId, options, fn)
```

This cuts surface area without changing behavior.

### 6.3 `setRepoSource()` looks dead

I found no caller of `runtime.setRepoSource(...)` or `runtimeClient.setRepoSource(...)` outside the hook that defines it.

Evidence:

```txt
src/hooks/use-runtime-session.ts:80:        const result = await runtimeClient.setRepoSource(
```

No UI call sites found.

But it exists across the full stack:

- `src/hooks/use-runtime-session.ts`
- `src/agent/runtime-client.ts`
- `src/agent/runtime-worker-types.ts`
- `src/agent/runtime-worker.ts`
- `src/agent/session-runtime-registry.ts`
- `src/agent/agent-host.ts`

Recommendation:

- if dynamic repo retargeting is not planned imminently: delete it now
- if planned: add the actual caller soon, or it will rot

### 6.4 `src/agent/runtime.ts` is effectively test-only

`createRuntime()`:

```ts
// src/agent/runtime.ts
export function createRuntime(config?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    tools: config?.tools ?? [],
  }
}
```

Usage:

- only test reference: `tests/runtime-audit.test.ts:4-15`

This file is not part of runtime execution. It is just keeping a seam alive for an audit assertion.

Recommendation:

- remove file + replace test with direct assertion against actual runtime setup
- or move it to a tiny `runtime-audit-fixture.ts` if you insist on keeping the test

### 6.5 `src/agent/live-runtime.ts` is pure indirection

File contents:

```ts
export { streamChatWithPiAgent } from "@/agent/provider-stream"
```

Only imported from `src/agent/agent-host.ts:26`.

Recommendation:

- inline import from `provider-stream`

### 6.6 `toOpenAIChatMessages()` and `toAnthropicMessages()` look dead

Definitions:

- `src/agent/message-transformer.ts:117-171`
- `src/agent/message-transformer.ts:226-343`

Search result:

- no app imports
- no test imports

These look like old adapter helpers from a previous transport approach.

Recommendation:

- delete both unless a near-term feature branch needs them

### 6.7 `WorkerMode` is dead right now

`createWorkerApi()` returns `{ api, mode }`, but `mode` is discarded.

Evidence:

- definition: `src/agent/runtime-worker-types.ts:4`
- returned from client factory: `src/agent/runtime-client.ts:14-37`
- no read sites found

Recommendation:

- either expose mode for diagnostics/UI
- or delete it

---

## 7. Places where we are actually simpler/better than Sitegeist

Worth stating, because otherwise cleanup can go in the wrong direction.

### 7.1 No window lock system

Sitegeist needs window-scoped session locks because navigation context is window-specific and sidepanel-owned.

See:

- `docs/sitegeist/docs/multi-window.md:1-213`
- `docs/sitegeist/src/background.ts:29-166`

Current app does not have this complexity. Good. It should not copy it.

### 7.2 No extension-only message types in runtime

Sitegeist has:

- navigation messages
- welcome messages
- artifact/welcome filtering in transformer
- page/runtime providers

Current runtime avoids all of that. Good.

### 7.3 Session storage model is not worse than Sitegeist

Sitegeist full session = whole message array blob in `sessions` store. Metadata duplicated in `sessions-metadata`.

Current app:

- messages normalized into separate `messages` rows
- session row carries only derived metadata + config

That is arguably a better fit for streamed persistence.

---

## 8. Specific improvement proposals

Ordered by value.

### P1. Split `AgentHost`

Why:

- biggest complexity node
- highest cognitive load
- most error-prone lifecycle code

Suggested split:

- `agent-session.ts`
  - construct `Agent`
  - expose `prompt/abort/setModel/setThinkingLevel/setTools`
- `session-persistence.ts`
  - `persistStreamingProgress`
  - `persistSessionBoundary`
  - message row conversion / metadata derivation
- `runtime-notices.ts`
  - error classification + dedupe + system notice append

Expected gain:

- smaller files
- easier unit tests
- less lifecycle coupling

### P1. Collapse mutation boilerplate in client + registry

Why:

- clear repetition
- low risk
- reduces surface for drift bugs

Targets:

- `src/agent/runtime-client.ts`
- `src/agent/session-runtime-registry.ts`

### P1. Delete stale API seams

Delete or justify:

- `src/agent/runtime.ts`
- `src/agent/live-runtime.ts`
- `toOpenAIChatMessages()`
- `toAnthropicMessages()`
- unused `WorkerMode`
- possibly `setRepoSource()` stack

This is the cleanest immediate simplification pass.

### P2. Decide whether `streamChat()` is product code or test seam

`streamChat()` in `src/agent/provider-stream.ts:433-490` is used by tests, but app runtime uses `streamChatWithPiAgent`.

This is fine if intentional.

If not intentional:

- move lower-level adapter tests to `streamChatWithPiAgent`
- keep only one public streaming surface

### P2. Make shared/dedicated worker mode observable if it matters

The runtime already branches on worker type, but UI has no visibility.

If useful:

- expose worker mode in debug/settings
- helps diagnose mobile/browser behavior

If not useful:

- delete mode type/value

### P3. Re-evaluate prompt surface

Current prompt is only 51 LOC and much slimmer than Sitegeist. Good.

But it still contains instructions about:

- parallel tool calling
- bash environment specifics
- output contract/source links

See `src/agent/system-prompt.ts:1-51`.

Question:

- does all of that belong in system prompt
- or should some move into tool descriptions / UI constraints

Not urgent. Just worth revisiting once runtime cleanup is done.

---

## 9. What I would not change

These looked correct.

### 9.1 Keep worker-hosted runtime

Given product constraints, I would keep:

- `SharedWorker` first
- `Worker` fallback
- Dexie as transcript source of truth

This is the right shape for browser tabs. Sitegeist’s in-page agent model does not map 1:1.

### 9.2 Keep local system notices out of LLM context

That split is clean and useful.

### 9.3 Keep incremental message persistence

For repo tools and streamed responses, current approach is more robust than snapshot-only session saves.

---

## 10. Concrete dead-code/stale-code list

High confidence:

- `src/agent/runtime.ts`
  - app-dead, test-only
- `src/agent/live-runtime.ts`
  - one-line alias
- `src/agent/message-transformer.ts`
  - `toOpenAIChatMessages()`
  - `toAnthropicMessages()`
- `src/agent/runtime-worker-types.ts`
  - `WorkerMode` if diagnostics not planned
- `src/hooks/use-runtime-session.ts`
  - `setRepoSource()` branch appears uncalled

Medium confidence:

- `src/agent/provider-stream.ts`
  - `streamChat()` may be test-only / internal seam

Not dead, but too coupled:

- `src/agent/agent-host.ts`
- `src/agent/session-runtime-registry.ts`
- `src/agent/runtime-client.ts`

---

## 11. Final judgment

From first principles:

- compared to Sitegeist, the current app did **not** overcomplicate the runtime in every direction
- the **core architectural divergence is justified** by browser-tab constraints + shared-worker requirement
- the **implementation around that divergence is where complexity accumulated**

So:

- keep the worker/Dexie/runtime split
- aggressively trim stale seams
- shrink `AgentHost`
- collapse wrapper boilerplate

That gets simpler, better, more robust, without regressing the parts that are solving real problems.
