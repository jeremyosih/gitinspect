# Durable fix plan: transcript/runtime split + orphaned tool-result cleanup

## locked decisions

1. **repair historical bad rows on read, with write-back**
   - when a session is loaded, run linker/canonicalizer
   - rewrite wrong `parentAssistantId`
   - drop true orphan tool results
   - persist cleaned rows back once

2. **keep a short compat window**
   - runtime `phase` becomes source of truth
   - legacy `session.isStreaming` / `status` can be mirrored temporarily
   - delete later after callers move

3. **single ownership law**
   - tool-result ownership derived from assistant `toolCall.id`
   - not from stored `parentAssistantId`
   - not from positional scan
   - not from replay-only pruning

4. **streaming stays in Dexie, but in `session_runtime`, not `messages`**

5. **one session view-model livequery**
   - selector merges transcript + runtime + linking before UI sees data

---

## condensed implementation steps

### phase 1. fix read-path first

- add shared linker
- use linker in:
  - `packages/pi/src/lib/chat-adapter.ts`
  - `packages/pi/src/agent/message-transformer.ts`
  - `packages/pi/src/lib/copy-session-markdown.ts`
  - `packages/pi/src/lib/export-markdown.ts`
- repair historical rows on load in:
  - `packages/pi/src/sessions/session-service.ts`

### phase 2. move streaming state to runtime row

- extend runtime row + helpers:
  - `packages/db/src/storage-types.ts`
  - `packages/db/src/session-runtime.ts`
- add:
  - `phase`
  - `streamMessage`
  - `pendingToolCallOwners`

### phase 3. replace snapshot reconstruction with event-driven writes

- create `packages/pi/src/agent/turn-event-store.ts`
- migrate:
  - `packages/pi/src/agent/agent-host.ts`
  - `packages/pi/src/agent/runtime-worker.ts`
  - `packages/pi/src/agent/worker-backed-agent-host.ts`
- eventually replace `packages/pi/src/agent/agent-turn-persistence.ts`

### phase 4. move chat UI to one selector

- create `packages/pi/src/sessions/session-view-model.ts`
- update `packages/ui/src/components/chat.tsx`

### phase 5. shrink FSM

- runtime `phase` becomes core truth:
  - `idle`
  - `running`
  - `interrupted`
- update:
  - `packages/pi/src/sessions/session-view-state.ts`
  - `packages/pi/src/agent/runtime-client.ts`
  - `packages/pi/src/sessions/session-notices.ts`

---

## files an agent should read first

### mandatory

1. `plan.md`
2. `packages/ui/src/components/chat.tsx`
3. `packages/pi/src/sessions/session-service.ts`
4. `packages/db/src/storage-types.ts`
5. `packages/db/src/session-runtime.ts`
6. `packages/db/src/schema.ts`
7. `packages/pi/src/agent/session-adapter.ts`
8. `packages/pi/src/lib/chat-adapter.ts`
9. `packages/pi/src/agent/message-transformer.ts`
10. `packages/pi/src/agent/agent-turn-persistence.ts`

### runtime/event flow

11. `packages/pi/src/agent/agent-host.ts`
12. `packages/pi/src/agent/runtime-worker-types.ts`
13. `packages/pi/src/agent/runtime-worker.ts`
14. `packages/pi/src/agent/worker-backed-agent-host.ts`
15. `packages/pi/src/agent/runtime-client.ts`
16. `packages/pi/src/sessions/session-view-state.ts`
17. `packages/pi/src/sessions/session-notices.ts`

### upstream semantics

18. `node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js`
19. `node_modules/@mariozechner/pi-agent-core/dist/agent.js`

### tests before edits

20. `tests/agent-host-persistence.test.ts`
21. `tests/message-transformer.test.ts`
22. `tests/session-notices.test.ts`
23. `tests/runtime-worker.test.ts`
24. `tests/chat-adapter.test.ts`
25. `tests/chat-message.test.tsx`
26. `tests/copy-session-markdown.test.ts`

### new tests to add

27. `tests/tool-result-linker.test.ts`
28. `tests/session-view-model.test.ts`
29. `tests/turn-event-store.test.ts`

---

## 0. outcome

Ship a refactor that:

- fixes orphaned tool results in UI, replay, export, interruption recovery
- keeps live Dexie-driven UI updates
- simplifies runtime state + FSM
- stops writing in-flight junk into canonical transcript
- supports future parallel tool execution without another rewrite

---

## 1. facts from code. ground truth first

### 1.1 UI is livequery-driven from Dexie already. but not from one source

`packages/ui/src/components/chat.tsx:148-168`

```ts
const loadedSessionState = useLiveQuery(async (): Promise<LoadedSessionState> => {
  const loaded = await loadSessionWithMessages(props.sessionId);
  ...
  return {
    kind: "active",
    messages: loaded.messages,
    session: loaded.session,
  };
}, [props.sessionId]);

const sessionRuntime = useLiveQuery(
  async () => (props.sessionId ? await getSessionRuntime(props.sessionId) : undefined),
  [props.sessionId],
);
```

So chat already depends on:

- transcript rows from `messages`
- session row
- runtime row
- in-memory `runtimeClient.hasActiveTurn(...)`

`packages/ui/src/components/chat.tsx:231-259`

```ts
const messages = loadedSessionState?.kind === "active" ? loadedSessionState.messages : [];
...
const activeSessionViewState = React.useMemo(
  () =>
    activeSession
      ? deriveActiveSessionViewState({
          hasLocalRunner: runtimeClient.hasActiveTurn(activeSession.id),
          hasPartialAssistantText,
          lastProgressAt: sessionRuntime?.lastProgressAt,
          leaseState: ownership,
          runtimeStatus: sessionRuntime?.status,
          sessionIsStreaming: activeSession.isStreaming,
        })
      : undefined,
```

### 1.2 transcript currently stores in-flight state

`packages/db/src/storage-types.ts:47-71`

```ts
export interface SessionData {
  ...
  isStreaming: boolean;
}

export type MessageStatus = "aborted" | "completed" | "error" | "streaming";

export type MessageRow = ChatMessage & {
  sessionId: string;
  status: MessageStatus;
};
```

`packages/pi/src/agent/agent-turn-persistence.ts:109-128`

```ts
export class AgentTurnPersistence {
  private assignedAssistantIds = new Map<string, string>();
  private persistedMessageIds = new Set<string>();
  private recordedAssistantMessageIds = new Set<string>();
  private currentAssistantMessageId?: string;
  private currentTurnId?: string;
  private lastDraftAssistant?: AssistantMessage;
  private lastTerminalStatus: TerminalAssistantStatus = undefined;
```

This is a smell. transcript persistence is carrying runtime bookkeeping.

### 1.3 tool results start with no owner

`packages/pi/src/agent/session-adapter.ts:36-50`

```ts
function normalizeMessage(message: Message, index: number): ChatMessage {
  ...
  case "toolResult":
    return {
      ...message,
      id,
      parentAssistantId: "",
    } satisfies ToolResultMessage;
```

### 1.4 ownership is inferred in 3 different ways today

#### persistence: positional scan

`packages/pi/src/agent/agent-turn-persistence.ts:383-412`

```ts
let activeAssistantId: string | undefined;

return normalizedMessages.map((message) => {
  if (message.role === "assistant") {
    messageId = this.assignedAssistantIds.get(message.id) ?? message.id;
    activeAssistantId = messageId;
  }

  const row = toMessageRow(...);

  if (row.role === "toolResult" && activeAssistantId) {
    row.parentAssistantId = activeAssistantId;
  }
```

#### replay: seen `toolCallId`

`packages/pi/src/agent/message-transformer.ts:71-90`

```ts
if (message.role === "toolResult") {
  if (seenToolCallIds.has(message.toolCallId)) {
    result.push(message);
  }
}
```

#### UI: trust stored `parentAssistantId`

`packages/pi/src/lib/chat-adapter.ts:39-65`

```ts
if (next.role !== "toolResult" || toolResults.has(next.toolCallId)) {
  continue;
}

if (next.parentAssistantId === message.id) {
  toolResults.set(next.toolCallId, next);
}
```

This split is root cause class. same fact. 3 rules.

### 1.5 final persistence still writes partial diffs, not canonical full rows

`packages/pi/src/agent/agent-turn-persistence.ts:568-585`

```ts
await this.persistSessionBoundary(
  {
    error: undefined,
    isStreaming: false,
  },
  [terminalAssistant],
  rowsForDerivation,
);
```

`packages/pi/src/agent/agent-turn-persistence.ts:669-676`

```ts
if (changedMessages.length > 0) {
  await putSessionAndMessages(this.session, changedMessages);
```

So session derivation can use one row set while DB write persists another.

### 1.6 worker protocol is snapshot/repair oriented, not event/reducer oriented

`packages/pi/src/agent/runtime-worker-types.ts:7-19`

```ts
export type WorkerSnapshot = {
  error: string | undefined;
  isStreaming: boolean;
  messages: AgentMessage[];
  streamMessage: AgentMessage | null;
};

export type WorkerSnapshotEnvelope = {
  rotateStreamingAssistantDraft?: boolean;
  runtimeErrors?: RuntimeErrorPayload[];
  sessionId: string;
  snapshot: WorkerSnapshot;
  terminalStatus?: "aborted" | "error";
};
```

`packages/pi/src/agent/runtime-worker.ts:229-279`

```ts
if (event.type === "turn_end" && event.toolResults.length > 0) {
  this.rotateStreamingAssistantDraft = true;
}
...
const envelope: WorkerSnapshotEnvelope = {
  rotateStreamingAssistantDraft: this.rotateStreamingAssistantDraft ? true : undefined,
  runtimeErrors: ...,
  sessionId: this.sessionId,
  snapshot,
  terminalStatus: this.latestTerminalStatus,
};
```

`packages/pi/src/agent/worker-backed-agent-host.ts:58-76`

```ts
await this.persistence.applySnapshot({
  snapshot: envelope.snapshot,
  terminalStatus: envelope.terminalStatus,
});

if (envelope.rotateStreamingAssistantDraft) {
  this.persistence.rotateStreamingAssistantDraft();
}
```

This is patch-on-patch territory.

### 1.7 upstream event order is stable enough for a cleaner design

`node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js:103-121`

```js
const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFn);
newMessages.push(message);
...
if (hasMoreToolCalls) {
  toolResults.push(...(await executeToolCalls(currentContext, message, config, signal, emit)));
  for (const result of toolResults) {
    currentContext.messages.push(result);
    newMessages.push(result);
  }
}
await emit({ type: "turn_end", message, toolResults });
```

`node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js:377-388`

```js
const toolResultMessage = {
  role: "toolResult",
  toolCallId: toolCall.id,
  toolName: toolCall.name,
  content: result.content,
  details: result.details,
  isError,
  timestamp: Date.now(),
};
await emit({ type: "message_start", message: toolResultMessage });
await emit({ type: "message_end", message: toolResultMessage });
```

`node_modules/@mariozechner/pi-agent-core/dist/agent.js:291-300`

```js
case "message_start":
  this._state.streamMessage = event.message;
  break;
case "message_update":
  this._state.streamMessage = event.message;
  break;
case "message_end":
  this._state.streamMessage = null;
  this.appendMessage(event.message);
  break;
```

Meaning:

- completed messages already arrive at exact boundaries
- we do not need to reconstruct canonical history from snapshots

### 1.8 Dexie schema already allows richer runtime rows

`packages/db/src/schema.ts:150-157`

```ts
this.version(2).stores({
  ...
  session_runtime: "sessionId, status, ownerTabId, lastProgressAt, updatedAt",
  sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
});
```

Important: IndexedDB objects can carry extra **unindexed** fields without changing store definition. So we can extend `session_runtime` row shape first, without immediate DB version bump, as long as indexes stay the same.

---

## 2. target invariants

### 2.1 canonical transcript only stores completed history

Allowed in `messages` table:

- completed user messages
- completed assistant messages
- completed tool results
- completed system notices

Not allowed anymore:

- `status: "streaming"` transcript rows
- speculative draft assistant rows
- tool results whose owner cannot be proven

### 2.2 in-flight state lives in runtime row

Runtime row owns:

- phase (`idle` | `running` | `interrupted`)
- `streamMessage` partial assistant
- progress/error metadata
- optional current turn metadata

### 2.3 one rule for tool-result ownership

Source of truth:

- assistant `toolCall.id`
- not stored `parentAssistantId`
- not incidental position
- not replay-only pruning

### 2.4 UI / replay / export all consume same linker

No more 3 ownership rules.

### 2.5 keep Dexie livequery UX

Streaming still comes from Dexie.

Difference:

- completed rows -> `messages`
- partial current assistant -> `session_runtime`

---

## 3. target architecture

## 3.1 split durable transcript from runtime turn state

### transcript

Append-only completed rows.

### runtime

Single row per session. holds active turn state only.

Suggested runtime shape:

```ts
export type RuntimePhase = "idle" | "running" | "interrupted";

export interface SessionRuntimeRow {
  sessionId: string;
  phase: RuntimePhase;
  ownerTabId?: string;
  turnId?: string;
  lastProgressAt?: string;
  lastError?: string;
  updatedAt: string;

  // partial assistant only. never written to messages table.
  streamMessage?: AssistantMessage;

  // optional. useful during active tool phase. keyed by toolCallId.
  pendingToolCallOwners?: Record<string, string>;

  // temporary compat. keep until old callers are deleted.
  status?: SessionRuntimeStatus;
  assistantMessageId?: string;
  startedAt?: string;
}
```

Why this is enough:

- completed messages append directly to transcript on `message_end`
- only partial assistant needs a runtime buffer
- tool results can be linked using `pendingToolCallOwners[toolCallId]`

### note

Do **not** put `completedDelta` in runtime unless later proven necessary. start simpler. completed messages already have exact `message_end` boundaries upstream.

---

## 3.2 single shared linker

Create:

`packages/pi/src/agent/tool-result-linker.ts`

Core API:

```ts
import type { ChatMessage, ToolCall, ToolResultMessage } from "@gitinspect/pi/types/chat";

export interface LinkedToolExecution {
  assistantId: string;
  toolCall: ToolCall;
  toolResult?: ToolResultMessage;
}

export interface LinkedTranscript {
  messages: ChatMessage[];
  changed: boolean;
  executionsByAssistantId: ReadonlyMap<string, readonly LinkedToolExecution[]>;
}

export function linkToolResults(messages: readonly ChatMessage[]): LinkedTranscript {
  const pending = new Map<string, { assistantId: string; toolCall: ToolCall }>();
  const executionsByAssistantId = new Map<string, LinkedToolExecution[]>();
  const out: ChatMessage[] = [];
  let changed = false;

  for (const message of messages) {
    if (message.role === "assistant") {
      out.push(message);
      const toolCalls = message.content.filter(
        (part): part is ToolCall => part.type === "toolCall",
      );
      if (toolCalls.length > 0) {
        executionsByAssistantId.set(
          message.id,
          toolCalls.map((toolCall) => ({ assistantId: message.id, toolCall })),
        );
        for (const toolCall of toolCalls)
          pending.set(toolCall.id, { assistantId: message.id, toolCall });
      }
      continue;
    }

    if (message.role === "toolResult") {
      const owner = pending.get(message.toolCallId);
      if (!owner) {
        changed = true; // orphan dropped
        continue;
      }

      pending.delete(message.toolCallId);
      const linked: ToolResultMessage =
        message.parentAssistantId === owner.assistantId
          ? message
          : { ...message, parentAssistantId: owner.assistantId };

      if (linked !== message) changed = true;
      out.push(linked);

      const executions = executionsByAssistantId.get(owner.assistantId);
      const execution = executions?.find((entry) => entry.toolCall.id === message.toolCallId);
      if (execution) execution.toolResult = linked;
      continue;
    }

    out.push(message);
  }

  return { messages: out, changed, executionsByAssistantId };
}
```

Rules:

- assistant tool calls create pending ownership by `toolCall.id`
- tool result must match pending `toolCall.id`
- if no match -> drop
- if stored `parentAssistantId` wrong/missing -> rewrite
- works for 1 tool, N tools, future parallel, repeated turns

This linker becomes the only ownership law.

---

## 3.3 event-driven persistence. no snapshot reconstruction

Replace `AgentTurnPersistence` with a reducer/store driven by exact agent events.

Create:

`packages/pi/src/agent/turn-event-store.ts`

Core reducer shape:

```ts
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type {
  ChatMessage,
  AssistantMessage,
  ToolResultMessage,
  ToolCall,
} from "@gitinspect/pi/types/chat";

export type TurnMutation = {
  appendMessages?: ChatMessage[];
  runtimePatch?: Partial<SessionRuntimeRow>;
  clearRuntime?: boolean;
  terminalStatus?: "completed" | "aborted" | "error";
};

export function reduceAgentEvent(
  runtime: SessionRuntimeRow | undefined,
  event: AgentEvent,
): TurnMutation {
  switch (event.type) {
    case "message_start":
    case "message_update": {
      if (event.message.role !== "assistant") return { runtimePatch: { phase: "running" } };
      return {
        runtimePatch: {
          phase: "running",
          lastProgressAt: new Date().toISOString(),
          streamMessage: event.message as AssistantMessage,
        },
      };
    }

    case "message_end": {
      if (event.message.role === "user") {
        return {
          appendMessages: [event.message],
          runtimePatch: { phase: "running", lastProgressAt: new Date().toISOString() },
        };
      }

      if (event.message.role === "assistant") {
        const pendingToolCallOwners = { ...(runtime?.pendingToolCallOwners ?? {}) };
        for (const part of event.message.content) {
          if (part.type === "toolCall") pendingToolCallOwners[part.id] = event.message.id;
        }

        return {
          appendMessages: [event.message as AssistantMessage],
          runtimePatch: {
            phase: "running",
            lastProgressAt: new Date().toISOString(),
            streamMessage: undefined,
            pendingToolCallOwners,
          },
        };
      }

      if (event.message.role === "toolResult") {
        const assistantId = runtime?.pendingToolCallOwners?.[event.message.toolCallId];
        if (!assistantId) {
          return {
            runtimePatch: {
              phase: "running",
              lastProgressAt: new Date().toISOString(),
              lastError: `Dropped orphan tool result ${event.message.toolCallId}`,
            },
          };
        }

        const nextPending = { ...(runtime?.pendingToolCallOwners ?? {}) };
        delete nextPending[event.message.toolCallId];

        return {
          appendMessages: [
            { ...event.message, parentAssistantId: assistantId } as ToolResultMessage,
          ],
          runtimePatch: {
            phase: "running",
            lastProgressAt: new Date().toISOString(),
            pendingToolCallOwners: nextPending,
          },
        };
      }

      return { runtimePatch: { phase: "running" } };
    }

    case "turn_end":
      return { runtimePatch: { lastProgressAt: new Date().toISOString() } };

    case "agent_end":
      return {
        clearRuntime: true,
        terminalStatus: "completed",
      };
  }
}
```

Important: exact code can differ. the invariant matters:

- append completed messages on `message_end`
- store partial assistant only in runtime row
- never synthesize transcript rows from snapshots

---

## 3.4 one view-model selector for chat UI

Create:

`packages/pi/src/sessions/session-view-model.ts`

```ts
import { getSession, getSessionMessages, getSessionRuntime } from "@gitinspect/db/schema";
import { linkToolResults } from "@gitinspect/pi/agent/tool-result-linker";
import type { ChatMessage } from "@gitinspect/pi/types/chat";

export interface SessionViewModel {
  session: SessionData;
  runtime?: SessionRuntimeRow;
  displayMessages: ChatMessage[];
  hasPartialAssistantText: boolean;
  isStreaming: boolean;
}

export async function loadSessionViewModel(
  sessionId: string,
): Promise<SessionViewModel | undefined> {
  const [session, transcript, runtime] = await Promise.all([
    getSession(sessionId),
    getSessionMessages(sessionId),
    getSessionRuntime(sessionId),
  ]);

  if (!session) return undefined;

  const displayBase: ChatMessage[] = [...transcript];
  if (runtime?.streamMessage) {
    displayBase.push({ ...runtime.streamMessage, status: "streaming" } as ChatMessage);
  }

  const linked = linkToolResults(displayBase);

  return {
    session,
    runtime,
    displayMessages: linked.messages,
    hasPartialAssistantText:
      runtime?.streamMessage?.role === "assistant" &&
      runtime.streamMessage.content.some(
        (part) => part.type === "text" && part.text.trim().length > 0,
      ),
    isStreaming: runtime?.phase === "running",
  };
}
```

UI change:

- replace separate `loadSessionWithMessages()` + `getSessionRuntime()` livequeries with one `loadSessionViewModel()` livequery
- derive banner/composer state from this selector

This removes cross-query tearing.

---

## 3.5 smaller FSM

Today UI derives from `sessionIsStreaming` + `runtimeStatus` + lease + local runner.

`packages/pi/src/sessions/session-view-state.ts:47-79`

```ts
if (input.sessionIsStreaming) {
  if (input.hasLocalRunner) return { kind: "running-local", ... };
  if (input.leaseState.kind === "locked") return { kind: "running-remote", freshness: "live", ... };
  if (input.leaseState.kind === "stale") return { kind: "running-remote", freshness: "stale", ... };
  return { kind: "recovering", ... };
}
```

Replace core input with:

```ts
export type ActiveSessionViewInput = {
  hasLocalRunner: boolean;
  hasPartialAssistantText: boolean;
  lastProgressAt?: string;
  leaseState: SessionLeaseState;
  runtimePhase: "idle" | "running" | "interrupted";
};
```

Then derive:

- `running-local`
- `running-remote live/stale`
- `recovering`
- `interrupted`
- `ready`

from **runtime phase + lease + local runner** only.

No need for both `session.isStreaming` and `runtime.status` as independent truth.

---

## 4. implementation phases

## phase 1. fix read-path ownership first. stop old bad rows from poisoning UI/replay

### goal

Make all readers agree today. low risk. fast win.

### steps

1. Add `packages/pi/src/agent/tool-result-linker.ts`
2. Switch these files to use it:
   - `packages/pi/src/lib/chat-adapter.ts`
   - `packages/pi/src/agent/message-transformer.ts`
   - `packages/pi/src/lib/copy-session-markdown.ts`
   - `packages/pi/src/lib/export-markdown.ts`
3. Add one-time read repair in `loadSessionWithMessages()`:

```ts
export async function loadSessionWithMessages(id: string) {
  const session = await loadSession(id);
  if (!session) return undefined;

  const messages = await getSessionMessages(id);
  const linked = linkToolResults(messages);

  if (linked.changed) {
    await replaceSessionMessages(buildPersistedSession(session, linked.messages), linked.messages);
  }

  return { session, messages: linked.messages };
}
```

### payoff

- historical bad rows self-heal
- replay/UI/export all stop disagreeing
- new linker becomes reusable foundation

### note

Phase 1 alone already fixes a large share of orphan pain.

---

## phase 2. add runtime turn buffer fields. keep livequery

### goal

Stop using transcript rows for partial assistant state.

### steps

1. Extend `SessionRuntimeRow` in `packages/db/src/storage-types.ts`
2. Update `packages/db/src/session-runtime.ts` helpers to read/write:
   - `phase`
   - `streamMessage`
   - `pendingToolCallOwners`
3. Keep old `status`/`assistantMessageId`/`turnId` fields during transition
4. Do **not** change Dexie indexes yet. no version bump needed here.

Suggested helper API:

```ts
export async function patchSessionRuntime(
  sessionId: string,
  patch: Partial<SessionRuntimeRow>,
): Promise<SessionRuntimeRow> { ... }

export async function clearSessionRuntime(sessionId: string): Promise<void> { ... }
```

---

## phase 3. replace snapshot-based persistence with event-driven append-only writes

### goal

Delete the complexity center.

### steps

1. Introduce `packages/pi/src/agent/turn-event-store.ts`
2. Move all persistence decisions to `reduceAgentEvent(...)`
3. Local host path:
   - `packages/pi/src/agent/agent-host.ts`
   - subscribe to `AgentEvent`
   - persist append/runtime patch directly from reducer
4. Worker path:
   - stop sending `WorkerSnapshotEnvelope`
   - send reduced turn mutations / runtime state
5. Replace `AgentTurnPersistence` usages incrementally

### target write behavior

#### on `message_end(user)`

- append user row to transcript
- set runtime `phase = running`

#### on `message_update(assistant)`

- update `runtime.streamMessage`
- update `lastProgressAt`

#### on `message_end(assistant)`

- append assistant row to transcript
- clear `runtime.streamMessage`
- register each `toolCall.id -> assistant.id` in runtime map

#### on `message_end(toolResult)`

- look up `runtime.pendingToolCallOwners[toolCallId]`
- if found, append linked toolResult row to transcript
- if not found, drop + emit system/runtime notice
- remove consumed tool call from runtime map

#### on `agent_end`

- clear `streamMessage`
- clear pending tool map
- set phase `idle`
- clear last error if completed

#### on error/abort before final completion

- set phase `interrupted`
- keep `streamMessage` if partial assistant exists
- keep `lastError`

### what gets deleted after this phase

- `rotateStreamingAssistantDraft`
- `assignedAssistantIds`
- `persistedMessageIds`
- snapshot diff logic
- transcript `status: "streaming"` writes

---

## phase 4. move UI to one view-model livequery

### goal

No more mixed snapshots from 2 Dexie queries + in-memory truth.

### steps

1. Add `packages/pi/src/sessions/session-view-model.ts`
2. Update `packages/ui/src/components/chat.tsx`
3. Replace:
   - `loadSessionWithMessages()` livequery
   - `getSessionRuntime()` livequery
4. Use one livequery:

```ts
const sessionView = useLiveQuery(
  async () => (props.sessionId ? await loadSessionViewModel(props.sessionId) : undefined),
  [props.sessionId],
);
```

5. Derive:
   - `messages`
   - `hasPartialAssistantText`
   - `isStreaming`
   - banner/composer state

from `sessionView`

### payoff

- livequery UX preserved
- fewer transient mismatches
- component simpler

---

## phase 5. collapse the FSM

### goal

Core state machine small. view state derived.

### new runtime phase transitions

```text
idle
  -> running      on startTurn / first message_start
running
  -> idle         on agent_end success
running
  -> interrupted  on crash / watchdog / abort / provider error before clean end
interrupted
  -> running      on continue / retry
interrupted
  -> idle         on explicit discard / successful repair cleanup
```

### file changes

- `packages/pi/src/sessions/session-view-state.ts`
- `packages/pi/src/agent/runtime-client.ts`
- `packages/pi/src/sessions/session-notices.ts`

### compatibility rule

Until cleanup is complete:

- runtime `phase` is source of truth
- `session.isStreaming` is compat only. write it from runtime phase when needed.

---

## phase 6. cleanup old legacy fields + helpers

### after all callers moved

Remove / deprecate:

- `SessionData.isStreaming` as source of truth
- `MessageRow.status = "streaming"`
- `parentAssistantId` as trusted source of truth
- `pruneOrphanToolResults()` bespoke logic
- `rotateStreamingAssistantDraft()`
- `WorkerSnapshotEnvelope`
- snapshot repair heavy paths

### optional later DB cleanup

If we want to remove indexes on `sessions.isStreaming` or `messages.status`, then do a real Dexie version bump later. Not needed for first durable fix.

---

## 5. file-by-file plan

## new files

### `packages/pi/src/agent/tool-result-linker.ts`

- single ownership/linking law
- used by UI, replay, export, repair

### `packages/pi/src/agent/turn-event-store.ts`

- reducer + persistence helpers for exact `AgentEvent`s

### `packages/pi/src/sessions/session-view-model.ts`

- one livequery-facing selector for transcript + runtime + derived flags

## files to rewrite heavily

### `packages/pi/src/agent/agent-turn-persistence.ts`

Plan: replace entirely. if easier, keep filename but rewrite internals around event reducer. preferred: new file + delete old class after migration.

### `packages/pi/src/agent/runtime-worker.ts`

- stop building whole snapshots for persistence
- emit reduced runtime updates / committed messages

### `packages/pi/src/agent/worker-backed-agent-host.ts`

- apply reduced turn updates
- stop calling `applySnapshot(...)`
- stop handling `rotateStreamingAssistantDraft`

### `packages/pi/src/agent/agent-host.ts`

- local host uses same reducer/store as worker-backed path

## files to update moderately

### `packages/db/src/storage-types.ts`

- add runtime phase + runtime fields
- keep compat fields for now

### `packages/db/src/session-runtime.ts`

- patch/clear helpers
- runtime phase becomes primary state

### `packages/pi/src/lib/chat-adapter.ts`

- use linker output, not raw `parentAssistantId`

### `packages/pi/src/agent/message-transformer.ts`

- replace orphan pruning + reorder logic with linker-backed canonicalization
- only emit `function_call_output` for linked tool results

### `packages/pi/src/sessions/session-service.ts`

- read repair for old bad transcripts
- later maybe delegate to session view-model

### `packages/pi/src/sessions/session-view-state.ts`

- switch to runtime phase input

### `packages/ui/src/components/chat.tsx`

- use session view-model livequery

### `packages/pi/src/lib/copy-session-markdown.ts`

### `packages/pi/src/lib/export-markdown.ts`

- use linker-backed tool execution view

---

## 6. migration + compatibility strategy

## stage A. stop new bugs

- link on read
- append canonical tool results only
- stop trusting stored `parentAssistantId`

## stage B. stop new streaming junk in transcript

- runtime holds partial assistant
- transcript only gets completed `message_end` rows

## stage C. self-heal old sessions

On session load:

1. load transcript
2. run linker
3. if changed, rewrite transcript with `replaceSessionMessages(...)`
4. continue normally

This lets old broken sessions heal lazily. no separate migration job needed.

---

## 7. tests. must be exhaustive here

## new tests

### `tests/tool-result-linker.test.ts`

Cases:

1. links tool result to owning assistant by `toolCallId`
2. rewrites wrong `parentAssistantId`
3. drops orphan tool result with no matching tool call
4. handles multiple tool calls in one assistant message
5. handles repeated tool-call ids across turns safely
6. preserves standalone assistant/user/system rows

Example:

```ts
it("links multiple tool results to one assistant", () => {
  const assistant = assistantMessage([
    { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a" } },
    { type: "toolCall", id: "call-2", name: "bash", arguments: { command: "pwd" } },
  ]);

  const linked = linkToolResults([
    assistant,
    toolResult({ toolCallId: "call-1", parentAssistantId: "" }),
    toolResult({ toolCallId: "call-2", parentAssistantId: "wrong" }),
  ]);

  expect(linked.messages).toEqual([
    assistant,
    expect.objectContaining({ toolCallId: "call-1", parentAssistantId: assistant.id }),
    expect.objectContaining({ toolCallId: "call-2", parentAssistantId: assistant.id }),
  ]);
});
```

### `tests/session-view-model.test.ts`

Cases:

1. returns transcript + runtime partial assistant merged for display
2. derives `hasPartialAssistantText` from runtime `streamMessage`
3. uses linker so standalone orphan tool result is hidden/dropped
4. shows streaming assistant from runtime even though transcript has only completed rows

### `tests/turn-event-store.test.ts`

Cases:

1. `message_end(user)` appends transcript row
2. `message_update(assistant)` only updates runtime stream message
3. `message_end(assistant with tool calls)` appends transcript + registers pending tool owners
4. `message_end(toolResult)` appends linked tool result + consumes pending owner
5. orphan tool result gets dropped
6. `agent_end` clears runtime
7. error/abort moves runtime to interrupted and keeps partial assistant

## update existing tests

### `tests/agent-host-persistence.test.ts`

Replace snapshot/diff expectations with:

- no transcript row with `status: "streaming"`
- completed assistant/toolResult rows appended immediately
- runtime row contains partial assistant during streaming
- no orphan rows after successful tool turn

### `tests/message-transformer.test.ts`

- replay input built from linker-backed canonical transcript
- never emits orphan `function_call_output`
- preserves valid multi-tool outputs

### `tests/session-notices.test.ts`

- interruption repair uses runtime phase + linker
- transcript repair does not rewrite valid canonical rows unnecessarily

### `tests/chat-adapter.test.ts`

- derive assistant view from linker output, not raw `parentAssistantId`

### `tests/runtime-worker.test.ts`

- worker emits reduced runtime updates / committed messages
- no `rotateStreamingAssistantDraft` expectation anymore

---

## 8. done criteria

Refactor is done when all are true:

- no code path writes `status: "streaming"` message rows
- `session_runtime` stores partial assistant state
- UI live streaming still works via Dexie livequery
- all readers use one linker
- historical orphan rows self-heal on load
- `rotateStreamingAssistantDraft` deleted
- `assignedAssistantIds` / `persistedMessageIds` deleted
- replay, UI, export, repair all agree on tool ownership
- multi-tool turns pass
- future parallel tool execution would not require changing ownership logic

---

## 9. practical recommendation on execution order

Implement in this exact order:

1. linker + read repair
2. view-model selector
3. runtime row fields
4. event reducer/store
5. local host migration
6. worker path migration
7. FSM cleanup
8. legacy field cleanup

Why this order:

- early phases fix user-visible orphan bugs fast
- later phases remove complexity without breaking livequery UX
- each phase leaves repo in a shippable state

---

## 10. non-goal for this plan

Do **not** bundle true parallel tool execution in same refactor.

But design above supports it because ownership is keyed by `toolCallId`, not sequential position. Upstream already guarantees toolResult messages carry `toolCallId` and tool results are emitted after assistant message_end.

---

## 11. short version

The durable fix is not “better repair”.

It is:

- canonical transcript = completed rows only
- runtime row = partial assistant only
- one linker = one ownership law
- one livequery selector = one display model
- event-driven append = no snapshot reconstruction

That kills the orphan class at the architecture level.
