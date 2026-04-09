# plan-dexie.md

## goal

Add two related capabilities to GitInspect while preserving the existing local-first experience:

1. **Public read-only sharing** of a conversation at `/share/$sessionId`
2. **Cross-device sync** for paid users via Dexie Cloud, while free users remain purely local

These should ship in **separate phases** with a shared foundation, but the implementation must stay boring and incremental.

---

# locked product decisions

These are the decisions this plan assumes.

## sharing

- Public route is **`/share/$sessionId`**
- The shared page shows a **read-only transcript**
- The shared page still shows a **prompt input**
- Submitting on the shared page does **not** continue the public session
- Instead it starts a **new private conversation** in the normal app, seeded from the shared transcript
- For v1, the new conversation is seeded using the **same markdown export idea as `Copy as Markdown`**
- The local authoring session keeps working exactly as today
- The dedicated share page stays; we do **not** overload `/chat/$sessionId` with public-read semantics

## share button

- There is a **Share** button in the prompt-area session actions, next to **Copy as Markdown** on desktop
- The button is **visible to everyone**
- If the user is **not Pro**, the button:
  - still renders
  - shows a tooltip on desktop explaining **Pro users only**
  - on click redirects to the **pricing/subscription** settings panel
- If the user **is Pro**, Share publishes and copies the public URL to clipboard with toast feedback
- Once published, Share becomes **Unshare**
- Unshare is only available to the **owner**

## sync

- Free users stay **purely local**
- Paid users get **Dexie Cloud sync** across devices
- Sync is gated by a dedicated **sync entitlement** check backed by Autumn
- The browser should **not configure Dexie Cloud at all** for free users
- Better Auth remains the **single app auth system**
- The browser should use an **explicit app fetcher** for Dexie Cloud tokens
- Do **not** rely on the Better Auth Dexie browser plugin as the production app interface
- Do **not** use Dexie eval → prod as the app-level product model
- If we still need Dexie `prod` users later, reconcile that in billing lifecycle / webhook code, not in bootstrap
- `/api/dexie-cloud-bootstrap` is transitional code and should be deleted in the target implementation
- Share remains a **product feature** gated by Autumn Pro
- Sync and Share may use the same paid plan initially, but they should remain **separate entitlement checks** in code (`isSyncEntitled()` vs `isShareEntitled()`)

## architecture

- **Do not split the browser into two Dexie databases**
- Keep **one `AppDb`** in the browser
- Sync only the conversation tables needed for cross-device continuity
- Keep sensitive and runtime-only tables local-only
- Public shares are written through Dexie Cloud REST into `rlm-public`

## UX / UI reuse

- Reuse current chat building blocks aggressively:
  - `ChatMessageBlock`
  - `Conversation`
  - `ChatComposer`
  - `messagesToMarkdown()` / `copySessionToClipboard()`
- Do **not** try to reuse all of `Chat.tsx` wholesale for the share route
- Instead extract small reusable pieces and keep route-specific orchestration separate

---

# current implementation status

The current repo contains a **first-pass Dexie auth bridge**, but this plan no longer treats it as the final architecture.

Currently present in code:

- `packages/better-auth-dexie-cloud`
  - generic Better Auth server/client bridge for Dexie Cloud token exchange
- `packages/auth/src/index.ts`
  - registers the Dexie Cloud server plugin when Dexie env vars are present
- `apps/web/src/lib/auth-client.ts`
  - registers the Dexie Cloud client plugin
- `/api/dexie-cloud-bootstrap`
  - currently performs side effects before sync starts
- current `claims.sub` policy
  - prefer `session.user.ghId`
  - fall back to `session.user.id` only as rollout safety

This is useful prototype code, but it is **not** the target design.

The target design in this document assumes:

- remove the browser plugin from the app flow
- replace bootstrap side effects with explicit paid-sync gating
- boot free users local-only and paid users cloud-enabled
- keep sync entitlement separate from share entitlement in code

Therefore the rest of this document should be read as the cleanup path from the current prototype to the target architecture.

# corrected architecture summary

## recommended architecture

Use:

1. **one browser `AppDb`**
2. **Dexie Cloud sync on the same DB** for `sessions` + `messages`, but only for paid users
3. **local-only tables in the same DB** via Dexie Cloud `unsyncedTables`
4. **Dexie Cloud REST** for public share snapshots in `rlm-public`

## why one browser DB is the right move

The current app already assumes that session state is coordinated inside a single local DB.

Today, writes and repairs span:

- `sessions`
- `messages`
- `sessionRuntime`

Examples in the repo:

- `packages/db/src/schema.ts` uses `runConversationTransaction()` across conversation tables
- `packages/pi/src/agent/turn-event-store.ts` writes session + message + runtime state together
- `packages/pi/src/sessions/session-service.ts` sanitizes and repairs session state in-place

A split between “local DB” and “sync DB” would force new transaction boundaries, new consistency rules, and a much larger refactor surface.

The boring path is:

- keep one browser DB
- keep the current schema module
- sync only the tables that should roam across devices
- keep runtime / keys / settings / repo metadata local-only

That preserves current assumptions and keeps the diff smaller.

---

# phase 0 — research + implementation packet for a fresh agent

This section is the handoff packet for an agent starting fresh.

## Dexie docs to read first

### public sharing

1. **Add public data**
   - https://dexie.org/docs/cloud/add-public-data
   - confirms that `rlm-public` can only be written through **CLI or REST**, not browser sync

2. **REST API**
   - https://dexie.org/docs/cloud/rest-api
   - especially:
     - `/token`
     - `/public/...`
     - `/my/...`
     - `/users`

### sync + auth

3. **db.cloud.configure()**
   - https://dexie.org/docs/cloud/db.cloud.configure()
   - important for:
     - `fetchTokens`
     - `requireAuth`
     - `unsyncedTables`

4. **Authentication**
   - https://dexie.org/docs/cloud/authentication
   - important for custom auth / existing auth integration

5. **db.cloud.currentUser**
   - https://dexie.org/docs/cloud/db.cloud.currentUser
   - use for sync status UX and canonical Dexie identity inspection

6. **Best practices**
   - https://dexie.org/docs/cloud/best-practices
   - especially around IDs and synced-table migration limits

## important repo files

### current local Dexie storage

- `packages/db/src/db.ts`
  - `AppDb` definition and singleton

- `packages/db/src/schema.ts`
  - Dexie schema + migrations

- `packages/db/src/cloud.ts`
  - Dexie Cloud boot/config helpers

- `packages/db/src/types.ts`
  - `SessionData`, `MessageRow`, runtime rows, settings, etc.

### session orchestration

- `packages/pi/src/sessions/session-service.ts`
  - session creation / load / persist helpers

- `packages/pi/src/sessions/session-actions.ts`
  - route helpers, session creation entrypoints, delete flow

- `packages/pi/src/lib/copy-session-markdown.ts`
  - this is the crucial reuse point for forking from a shared transcript

- `packages/pi/src/agent/turn-event-store.ts`
  - current queued write path that depends on single-DB semantics

### chat UI

- `packages/ui/src/components/chat.tsx`
  - current orchestration for local session loading, first send, runtime actions, copy button placement

- `packages/ui/src/components/chat-composer.tsx`
  - current prompt input shell to extend with session utility actions

- `packages/ui/src/components/ai-elements/prompt-input.tsx`
  - reusable prompt button/menu primitives

- `packages/ui/src/components/chat-message.tsx`
  - read-only assistant/user/tool rendering that should be reused on the share page

### routing / layout

- `apps/web/src/routes/chat.$sessionId.tsx`
- `apps/web/src/routes/chat.tsx`
- `apps/web/src/routes/__root.tsx`
  - root layout currently always renders sidebar/header
  - share route needs a minimal shell or conditional root layout

### auth / billing / server

- `apps/web/src/hooks/use-subscription.ts`
  - current Autumn subscription status source

- `apps/web/src/lib/autumn.server.ts`
  - server-side Autumn identity helpers

- `apps/web/src/middleware/auth.ts`
  - Better Auth session extraction

- `packages/auth/src/index.ts`
  - current Better Auth server config
  - currently registers the Dexie Cloud Better Auth plugin as prototype code

- `packages/better-auth-dexie-cloud/src/index.ts`
  - current generic Better Auth server plugin for Dexie Cloud token exchange
  - useful reference, but not the target app interface in this plan

- `packages/better-auth-dexie-cloud/src/client.ts`
  - current generic Better Auth client plugin
  - should be removed from the app path in favor of an explicit fetcher

- `apps/web/src/lib/auth-client.ts`
  - current Better Auth web client
  - should stop being the source of Dexie `fetchTokens`

- `apps/web/src/routes/api/feedback.ts`
- `apps/web/src/routes/api/proxy.ts`
  - examples of current server route style for later share APIs

## secrets / setup a fresh agent will need

### Dexie Cloud

- `DEXIE_CLOUD_DB_URL`
- `DEXIE_CLOUD_CLIENT_ID`
- `DEXIE_CLOUD_CLIENT_SECRET`
- client must have scopes sufficient for:
  - `ACCESS_DB`
  - `IMPERSONATE` (for custom auth token exchange)
  - `GLOBAL_READ`
  - `GLOBAL_WRITE`

### web env

- `VITE_DEXIE_CLOUD_DB_URL`

### Better Auth / app auth

- existing Better Auth env already present

### billing

- existing Autumn env already present

## phase 0 remaining spikes before AppDb integration

These are the only meaningful unknowns still worth validating up front.

### spike A — single `AppDb` + `unsyncedTables`

Goal:

- verify the current `AppDb` can adopt `dexie-cloud-addon`
- verify `sessions` + `messages` sync correctly
- verify `settings`, `providerKeys`, `repositories`, `daily_costs`, `session_runtime`, and `session_leases` remain local-only via `unsyncedTables`
- verify existing conversation queries and repairs still work in one DB

If this works:

- keep one browser DB

If this does **not** work:

- stop and re-evaluate; do **not** silently introduce a second browser DB

### spike B — explicit billing-aware Dexie token route

Current code already proves that Better Auth can mint Dexie tokens, but the generic browser plugin is not the target interface.

Remaining goal:

- add an explicit app route such as `/api/dexie-cloud-token`
- verify the route can obtain real Dexie Cloud tokens against the target DB
- verify `public_key` is forwarded correctly end-to-end
- verify the route rejects unpaid users with `403`
- verify Dexie sees the intended user id (`ghId`) for signed-in GitHub users

If this works:

- remove the browser plugin from the app flow
- do **not** keep the generic Better Auth plugin as the main app interface

### spike C — paid-only sync boot gating

Goal:

- verify free users never configure Dexie Cloud and remain purely local
- verify paid users configure Dexie Cloud before first real DB usage
- verify free → paid upgrade uses a deliberate reload into cloud mode
- verify sign-out returns the app to local-only mode without breaking local use

This spike matters because GitInspect already touches the DB very early, so a late React effect is too late to switch cleanly from local mode into cloud mode.

### spike D — sign-out / logout semantics

Goal:

- verify what happens to synced local data when the user signs out of Better Auth
- decide whether app sign-out should:
  - keep local conversation history on device
  - disconnect sync only
  - or clear synced user data

This must be explicitly decided before shipping. Dexie Cloud logout semantics are not the same as a normal web-app “clear cookie only” mental model.

### spike E — same cloud DB for private sync + public share tables

Goal:

- verify the cloud database can contain REST-written public tables (`publicSessions`, `publicMessages`, `shareOwners`) while the browser app only syncs the conversation tables it declares locally

If this works:

- use one Dexie Cloud database for both sync + public shares

If this does **not** work:

- pause and revisit; do not add complexity until this is confirmed

---

# browser data model

## keep one browser `AppDb`

The browser keeps the existing `AppDb` shape.

### synced tables

These become the synced conversation tables:

- `sessions`
- `messages`

### local-only tables

These remain local-only in the same DB:

- `provider-keys`
- `settings`
- `repositories`
- `daily_costs`
- `session_runtime`
- `session_leases`

### policy

For v1, **all settings remain local-only**.

That keeps the privacy story simple and avoids surprising cross-device coupling for provider config, runtime recovery metadata, or repo history.

## ID strategy

Continue using current UUID-based IDs.

Dexie Cloud best practices allow app-generated globally unique string IDs, so existing `createId()` / `crypto.randomUUID()` behavior is the correct fit.

## type changes for synced rows

The synced conversation rows should tolerate Dexie Cloud reserved properties:

```ts
export type SyncedSessionRow = SessionData & {
  owner?: string;
  realmId?: string;
};

export type SyncedMessageRow = MessageRow & {
  owner?: string;
  realmId?: string;
};
```

These do not change product semantics; they simply acknowledge Dexie Cloud metadata on synced rows.

---

# public share data model

These tables are written through REST, not browser sync.

## public session record

```ts
// packages/db/src/public-share-types.ts
import type { ResolvedRepoSource } from "@gitinspect/db";

export interface PublicSessionRecord {
  id: string; // sessionId
  realmId: "rlm-public";
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  title: string;
  preview: string;
  messageCount: number;
  sourceUrl?: string;
  repoSource?: Pick<ResolvedRepoSource, "owner" | "repo" | "ref" | "refOrigin" | "resolvedRef">;
  version: 1;
}
```

## public message record

```ts
import type { ChatMessage } from "@gitinspect/pi/types/chat";

export interface PublicMessageRecord {
  id: string; // `${sessionId}:${messageId}`
  realmId: "rlm-public";
  sessionId: string;
  order: number;
  timestamp: number;
  value: ChatMessage;
}
```

### important correction

Public message snapshots must preserve **`order`** as well as `timestamp`.

Use `order` for transcript fidelity and stable rendering. `timestamp` alone is not a strong enough ordering contract for persisted replay.

## private ownership record

Needed so **Unshare** is server-enforced and owner-only without exposing ownership publicly.

```ts
export interface ShareOwnerRecord {
  id: string; // sessionId
  ownerUserId: string; // Dexie claims.sub (for this app: prefer Better Auth ghId)
  realmId: string; // same as ownerUserId (private realm)
  createdAt: string;
  updatedAt: string;
}
```

## why `shareOwners` exists

The public snapshot tables are public.

We do **not** want to store owner metadata in them.

`shareOwners` gives us:

- owner-only Unshare
- owner-only republish after the initial publish
- cross-device share state for the same signed-in user

---

# sync configuration

## `AppDb` stays single, but cloud mode is opt-in at boot

Do **not** create a second browser DB.

Instead, keep one `AppDb` and only configure Dexie Cloud for **paid** users, before first open.

### target shape

```ts
// apps/web/src/lib/fetch-dexie-cloud-tokens.ts
import type { DexieCloudTokenParams } from "@gitinspect/db";

export async function fetchDexieCloudTokens(tokenParams: DexieCloudTokenParams) {
  const response = await fetch("/api/dexie-cloud-token", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(tokenParams),
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Dexie Cloud token.");
  }

  return await response.json();
}
```

```ts
// apps/web/src/lib/bootstrap-dexie-cloud.ts
import { initDbCloud } from "@gitinspect/db";
import { env } from "@gitinspect/env/web";
import { fetchDexieCloudTokens } from "@/lib/fetch-dexie-cloud-tokens";

export function bootstrapDexieCloud(syncEnabled: boolean) {
  if (!syncEnabled || !env.VITE_DEXIE_CLOUD_DB_URL) {
    return;
  }

  initDbCloud({
    databaseUrl: env.VITE_DEXIE_CLOUD_DB_URL,
    fetchTokens: fetchDexieCloudTokens,
  });
}
```

### important packaging + timing constraints

- `packages/db` must **not** import app auth or billing code
- decide whether sync is enabled **before** normal DB consumers force first open when possible
- do **not** call `syncDb()` when cloud was never configured
- do **not** replace the shared `db` singleton with per-route DB instances unless the spike proves it is necessary
- free → paid upgrade should persist a boot flag and reload into cloud mode rather than trying to hot-reconfigure an already-open singleton DB

## why not `databaseUrl: undefined` as the core design

The addon clearly branches on whether a `databaseUrl` exists, so omitting it can disable sync behavior.

However, the clean product architecture should be:

- free / signed-out users: **do not call `initDbCloud()` at all**
- paid users: configure Dexie Cloud before first open

That avoids leaning on undocumented reconfiguration behavior for an already-open DB and keeps the free tier obviously local-only.

---

# auth strategy

## recommended approach

Use **Better Auth as the only user-facing auth system**, but replace the browser plugin magic with an explicit app-specific Dexie token route.

Why this is the right fit:

- app already has Better Auth
- app already has Autumn billing
- sync entitlement is app-specific and billing-aware
- the real trust boundary is the **server-side token minting path**, not a browser helper wrapper
- no second login UI should appear
- one identity spine for app auth + billing + sync + share ownership

## target auth bridge shape

Use an explicit app route instead of `authClient.dexieCloud.createFetchTokens()`.

Target shape:

- browser helper: `fetchDexieCloudTokens()`
- server route: `/api/dexie-cloud-token`
- Better Auth session verification happens inside that route
- the route checks `isSyncEntitled()` before minting any Dexie token
- unpaid users get `403`
- paid users get a Dexie token minted server-to-server

## important notes

- Dexie client credentials must stay server-side
- the client **must** forward Dexie token params unchanged; do not drop `public_key`
- the canonical Dexie user id for GitInspect should be Better Auth `user.ghId`
- the current code falls back to `user.id` only as rollout safety
- this same `claims.sub` becomes the canonical owner id for `shareOwners`
- keep `isSyncEntitled()` separate from `isShareEntitled()` even if they initially check the same paid plan

## what to remove from the current prototype

- remove the Better Auth Dexie **client plugin** from the app path
- stop using `authClient.dexieCloud.createFetchTokens()` as the browser interface
- delete `/api/dexie-cloud-bootstrap` from the happy path

That route is not bootstrap; it is a billing/tier reconciliation side effect disguised as bootstrap.

## Dexie user tiering

Do **not** use Dexie eval → prod as the app-level product model.

If Dexie `prod` users are still useful later for quota / license reasons, reconcile them in:

- Autumn billing lifecycle / webhook code
- or a dedicated admin reconciliation flow

Do **not** mix that mutation into either the token route or sync bootstrap.

---

# sync lifecycle in the app

## paid-only sync boot

For v1, the intended lifecycle is:

1. signed-out or unpaid user boots **local-only**
2. paid user boots with **cloud sync enabled**
3. sync starts only when cloud was configured
4. free users never connect to Dexie Cloud and should not count toward Dexie user quota

## boot decision timing

The app touches the DB early, so a late React effect is too late to cleanly switch an already-open singleton DB from local mode into cloud mode.

Recommended v1 rule:

- determine `syncEnabled` before first normal DB usage when possible
- if a user upgrades from free → paid after the app is already running, persist a boot flag and **reload**
- on the next load, call `bootstrapDexieCloud(true)` before DB consumers run
- then trigger the first cloud sync

## target hook shape

```ts
export function useConversationSyncBootstrap(syncEnabled: boolean) {
  React.useEffect(() => {
    bootstrapDexieCloud(syncEnabled);
  }, [syncEnabled]);

  React.useEffect(() => {
    if (!syncEnabled) {
      return;
    }

    void syncDb().catch((error) => {
      console.error("Could not initialize Dexie sync", error);
    });
  }, [syncEnabled]);
}
```

This hook should stay small and boring:

- cloud bootstrap only if sync is enabled
- start sync only if cloud is configured
- no hidden billing side effects
- no new storage abstraction unless the spike proves it is necessary

## free → paid continuity

Because we are keeping one DB, the preferred path is:

1. free user chats locally
2. user becomes paid
3. app persists `syncEnabled = true`
4. app reloads
5. Dexie Cloud is configured before first DB use
6. initial sync uploads existing private session/message rows

### important rule

Do **not** build a custom local→sync copy loop unless the spike proves it is necessary.

Also do **not** try to hot-reconfigure an already-open singleton DB into cloud mode inside a late effect.

## sign-out semantics

**Chosen for implementation:** sign-out keeps local device data.

That means:

- Better Auth session ends
- paid sync stops
- app returns to local-only mode
- local conversations remain on device by default

This matches GitInspect’s local-first mental model better and avoids surprising data loss.

---

# sync status UX

Create a hook around Dexie Cloud observables **when cloud is configured**, and combine that with app-level knowledge of whether the current boot is local-only.

## minimum UI for v1

Add a small sync status affordance in the app header or footer that can show:

- local only
- connecting
- pending sync
- syncing
- synced
- offline
- sync error

If Dexie license issues still surface internally, present them as a generic sync problem rather than making Dexie eval/prod the user-facing product model.

---

# public sharing architecture

## route

Use **`/share/$sessionId`**.

The share route stays a dedicated published route. It is not the normal chat route with owner checks bolted onto it.

### why keep a dedicated share route

`/chat/$sessionId` and `/share/$sessionId` represent different products:

- `/chat/...` = private mutable workspace
- `/share/...` = published read-only artifact

Keeping them separate gives clearer code and clearer UX.

## route shape

```ts
// apps/web/src/routes/share.$sessionId.tsx
import { createFileRoute } from "@tanstack/react-router";
import { SharedConversationPage } from "@gitinspect/ui/components/shared-conversation-page";

export const Route = createFileRoute("/share/$sessionId")({
  component: ShareRoute,
  head: () => ({
    meta: [{ name: "robots", content: "noindex,nofollow" }],
  }),
});

function ShareRoute() {
  const { sessionId } = Route.useParams();
  return <SharedConversationPage sessionId={sessionId} />;
}
```

## public read path

Read directly from Dexie Cloud REST public endpoints.

```ts
export async function loadPublicSessionSnapshot(
  sessionId: string,
): Promise<{ session: PublicSessionRecord; messages: PublicMessageRecord[] } | undefined> {
  const sessionRes = await fetch(
    `${env.VITE_DEXIE_CLOUD_DB_URL}/public/publicSessions/${encodeURIComponent(sessionId)}`,
  );

  if (sessionRes.status === 404) {
    return undefined;
  }

  if (!sessionRes.ok) {
    throw new Error(`Failed to load shared session (${sessionRes.status})`);
  }

  const session = (await sessionRes.json()) as PublicSessionRecord;

  const messagesRes = await fetch(
    `${env.VITE_DEXIE_CLOUD_DB_URL}/public/publicMessages?sessionId=${encodeURIComponent(sessionId)}`,
  );

  if (!messagesRes.ok) {
    throw new Error(`Failed to load shared messages (${messagesRes.status})`);
  }

  const messages = (await messagesRes.json()) as PublicMessageRecord[];
  messages.sort((a, b) => (a.order === b.order ? a.timestamp - b.timestamp : a.order - b.order));

  return { messages, session };
}
```

---

# public snapshot serializer

Use a strict allowlist. Do not publish raw internal rows.

## session serializer

```ts
export function toPublicSessionRecord(
  sessionId: string,
  session: SessionData,
): PublicSessionRecord {
  return {
    id: sessionId,
    realmId: "rlm-public",
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    publishedAt: new Date().toISOString(),
    title: session.title,
    preview: session.preview,
    messageCount: session.messageCount,
    sourceUrl: session.sourceUrl,
    repoSource: session.repoSource
      ? {
          owner: session.repoSource.owner,
          repo: session.repoSource.repo,
          ref: session.repoSource.ref,
          refOrigin: session.repoSource.refOrigin,
          resolvedRef: session.repoSource.resolvedRef,
        }
      : undefined,
    version: 1,
  };
}
```

## message serializer

```ts
export function toPublicMessageRecords(
  sessionId: string,
  messages: MessageRow[],
): PublicMessageRecord[] {
  return messages
    .filter((message) => message.status !== "streaming")
    .filter((message) => message.role !== "system")
    .map((message) => ({
      id: `${sessionId}:${message.id}`,
      realmId: "rlm-public",
      sessionId,
      order: message.order,
      timestamp: message.timestamp,
      value: {
        ...message,
      },
    }));
}
```

## important policy

For v1:

- exclude `system` messages
- exclude `streaming` rows
- **include `toolResult` rows**

### why include tool results

`Copy as Markdown` currently derives tool sections from assistant tool calls plus linked tool results.

If public snapshots drop `toolResult` rows, the shared transcript is no longer equivalent to the current markdown export model.

So for v1, include them.

---

# public share safety model

## what `rlm-public` protects

The public realm is safe from arbitrary browser writes because `rlm-public` mutations require REST / CLI access with global write capability.

That is the right foundation for publishing.

## what it does not magically prove

If the publish API accepts a client-sent session snapshot and writes it to `rlm-public`, the server is still trusting the client for transcript contents.

That is acceptable for v1, but the trust model must be stated clearly.

## v1 trust model

For v1, the share API guarantees:

- the caller is signed in
- the caller is entitled to use Share
- payload shape is valid and sanitized
- after first publish, only the recorded owner may republish or unshare that `sessionId`

For v1, the share API does **not** guarantee:

- that the server independently verified the transcript against a canonical session store

That stronger guarantee can only exist later if the server becomes the canonical source for the private transcript.

---

# share API shape

Recommended API:

- `GET /api/public-shares/$sessionId`
  - returns owner-scoped state for current signed-in user
  - `{ isShared, canManage, publicUrl }`

- `PUT /api/public-shares/$sessionId`
  - publish or republish
  - requires signed-in + Pro

- `DELETE /api/public-shares/$sessionId`
  - unshare
  - requires signed-in + owner + Pro

## owner-state route

```ts
GET: async ({ params, request }) => {
  // 1. verify Better Auth session
  // 2. resolve current user id from session.user.id
  // 3. fetch shareOwners/<sessionId> via admin token
  // 4. return current-user-scoped state
};
```

## publish route

```ts
PUT: async ({ params, request }) => {
  // 1. verify Better Auth session
  // 2. verify Autumn Pro entitlement
  // 3. parse and validate { session, messages }
  // 4. ensure params.sessionId === session.id
  // 5. reject if session.isStreaming
  // 6. sanitize through allowlist serializers
  // 7. if shareOwners exists, require same owner to republish
  // 8. replace publicMessages for this sessionId (delete old snapshot rows first)
  // 9. upsert publicSessions + shareOwners through Dexie REST
  // 10. return public URL
};
```

## unshare route

```ts
DELETE: async ({ params, request }) => {
  // 1. verify Better Auth session
  // 2. verify current user owns shareOwners/<sessionId>
  // 3. delete publicSessions/<sessionId>
  // 4. delete all matching publicMessages rows for sessionId
  // 5. delete shareOwners/<sessionId>
  // 6. return { ok: true }
};
```

## republish correctness rule

Republish must **replace** the existing snapshot, not only upsert new rows.

Otherwise stale `publicMessages` rows can survive after local edits or repair.

---

# fork behavior from shared route

## recommended v1 behavior

When the user submits on `/share/$sessionId`, do **not** attempt to continue the shared session.

Instead:

1. build markdown from the public transcript using existing export code
2. apply a hard size cap
3. create a brand-new local/private conversation
4. send a seeded first prompt that includes:
   - transcript markdown
   - the user’s follow-up question
5. navigate to `/chat/$newSessionId`

### why this is the right v1

It reuses:

- `messagesToMarkdown()` from `copy-session-markdown.ts`
- existing session creation helpers
- existing runtime send flow

It avoids new persistence semantics for cloned seeded transcripts.

## seed prompt helper

```ts
export function buildSharedFollowupPrompt(input: { exportedMarkdown: string; userPrompt: string }) {
  return [
    "You are continuing from a shared GitInspect conversation.",
    "Use the following conversation export as context:",
    "",
    input.exportedMarkdown,
    "",
    "Now answer this new follow-up question:",
    input.userPrompt,
  ].join("\n");
}
```

## hard size cap

Do **not** seed arbitrarily large exports into the next prompt.

### v1 recommendation

- target roughly **20k–25k input tokens** if a tokenizer helper already exists in `@gitinspect/pi`
- otherwise fall back to a simple **character cap** (for example 60k–80k chars)
- preserve the most recent turns
- keep the repo/context header
- if truncation happens, prepend a short note that the transcript was truncated to recent turns

### important note

Do **not** default to a 100k-token seed. That is too large for a multi-model app and leaves too little room for the actual answer.

## extraction needed from `Chat.tsx`

Today `Chat.tsx` owns a lot of first-send behavior.

Extract a reusable hook/service such as:

```ts
export function useConversationStarter() {
  return {
    startNewConversation: async (input: {
      initialPrompt: string;
      repoSource?: ResolvedRepoSource;
      sourceUrl?: string;
    }) => {
      // auth checks
      // message entitlement checks
      // create session
      // runtimeClient.startInitialTurn(...)
      // track usage
      // navigate to /chat/$sessionId
    },
  };
}
```

Then both:

- normal local empty-state chat
- shared read-only page submit

can use the same starter.

That is the key reuse move.

---

# shared page shell and UX

## shell rule

The shared route should **not** use the normal app shell with sidebar.

Recommended root-layout rule:

- if route is `/share/$sessionId`
  - hide sidebar
  - use a minimal top bar or no app chrome
  - full-width centered read-only conversation + prompt

## shared page content reuse

Recommended reuse on the shared page:

- `Conversation`
- `ConversationContent`
- `ConversationScrollButton`
- `ProgressiveBlur`
- `ChatMessageBlock`
- `ChatComposer`

Do **not** reuse:

- runtime ownership hooks
- local session runtime banners
- repo combobox editing
- session sidebar assumptions

## shared page prompt copy

Use a different placeholder on the public route.

Suggested placeholder:

- `Ask a follow-up to start your own conversation…`

Suggested helper text near prompt:

- `This shared page is read-only. Sending a message starts a new private conversation in GitInspect.`

## share page behavior for owners

Even if the viewer is the owner, `/share/$sessionId` stays a published read-only artifact.

Owner conveniences may be added later, but the page contract should remain simple:

- shared page is read-only
- submit starts a new private conversation
- management actions remain explicit

---

# prompt-area session actions

## current state

`Chat.tsx` currently renders:

- repo combobox on the left
- `Copy as Markdown` button on the right
- prompt below

## target state

Treat this entire region as the **prompt area**.

### desktop

- keep the repo control above prompt on the left
- on the right, render:
  - `Copy as Markdown`
  - `Share` / `Unshare`

### mobile

Do **not** keep two text buttons there.

Instead:

- keep the prompt clean
- collapse utility actions into a compact overflow menu in the prompt footer
- menu items:
  - Copy as Markdown
  - Share / Unshare

## implementation move

Extract a reusable session utility action component.

```tsx
export function SessionUtilityActions(props: {
  canShare: boolean;
  isOwner: boolean;
  isPro: boolean;
  isShared: boolean;
  onCopy: () => void;
  onShare: () => void;
  onUpgradeClick: () => void;
}) {
  // desktop inline buttons + mobile overflow menu
}
```

## `ChatComposer` extension point

To avoid hardcoding Share into `Chat.tsx`, extend the composer API slightly.

```ts
export function ChatComposer(props: {
  // existing props...
  placeholder?: string;
  utilityActions?: React.ReactNode;
});
```

This gives a clean place for mobile overflow and future session actions.

---

# recommended implementation order

## phase 0 — replace the transitional auth / bootstrap prototype

- [ ] remove the Better Auth Dexie **client plugin** from `apps/web/src/lib/auth-client.ts`
- [ ] add an explicit `/api/dexie-cloud-token` route
- [ ] add `fetchDexieCloudTokens()` in app code
- [ ] add `isSyncEntitled()` and stop using share entitlement as a sync proxy
- [ ] delete `/api/dexie-cloud-bootstrap` from the sync happy path

## phase 1 — paid-only sync boot

- [ ] add a boot-time `syncEnabled` source for the web app
- [ ] call `bootstrapDexieCloud(syncEnabled)` only when sync is enabled
- [ ] keep signed-out and unpaid users purely local
- [ ] make free → paid upgrade persist a flag and reload into cloud mode
- [ ] make sign-out return the app to local-only mode without clearing local data

## phase 2 — sync verification + UX

- [ ] verify first paid boot uploads existing local `sessions` + `messages`
- [ ] verify cross-device continuity on a second device
- [ ] keep header states to: local only / connecting / pending sync / syncing / synced / offline / sync error
- [ ] remove any user-visible dependence on Dexie eval / prod semantics

## phase 3 — share cleanup + polish

- [ ] keep `isShareEntitled()` separate from `isSyncEntitled()`
- [ ] keep the dedicated `/share/$sessionId` flow and markdown-seeded fork behavior
- [ ] refine share page header / metadata
- [ ] refine mobile composer spacing and overflow menu
- [ ] refine toasts and empty states
- [ ] test copy/share/redirect flows on small screens

This replaces the older plugin / eval / bootstrap assumptions in the earlier draft.

---

# tests

## paid-only sync foundation

- [ ] signed-out user can still create and read local conversations
- [ ] unpaid signed-in user stays local-only and does **not** request Dexie tokens
- [ ] paid signed-in user can obtain a Dexie token through `/api/dexie-cloud-token`
- [ ] Dexie token exchange preserves `public_key`
- [ ] Dexie sees `ghId` as the signed-in GitInspect identity
- [ ] root bootstrap configures Dexie Cloud only when `syncEnabled === true`
- [ ] paid user sees the same private sessions on another device

## upgrade / continuity

- [ ] existing local guest sessions remain available after sign-in
- [ ] free → paid upgrade reloads into cloud mode cleanly
- [ ] first paid sync uploads pre-existing local private sessions/messages if the native path works
- [ ] no duplicate sessions are created during first paid sync
- [ ] sign-out returns the app to local-only mode without deleting local data

## public share read path

- [ ] `/share/$sessionId` loads public session + messages
- [ ] missing share shows not-found UI
- [ ] route is `noindex,nofollow`
- [ ] shared transcript sorts by `order` and remains stable

## publish / unshare

- [ ] non-signed-in publish denied server-side
- [ ] non-pro publish denied server-side
- [ ] first publish creates `publicSessions`, `publicMessages`, and `shareOwners`
- [ ] republish replaces stale public message rows
- [ ] owner can unshare
- [ ] non-owner cannot unshare
- [ ] public snapshot excludes system / streaming rows
- [ ] public snapshot includes tool results required for markdown export fidelity

## UI gating

- [ ] non-pro sees Share button
- [ ] non-pro click opens pricing settings
- [ ] pro publish copies URL and flips button to Unshare
- [ ] mobile overflow contains share/copy actions

## fork behavior

- [ ] shared-page submit creates a new private conversation
- [ ] new conversation first turn uses capped exported markdown seed
- [ ] transcript truncation notice appears when cap is hit
- [ ] redirect goes to `/chat/$newSessionId`

## sign-out semantics

- [ ] sign-out behavior matches the chosen product rule exactly
- [ ] local-only mode after sign-out is verified

---

# NOT in scope

- a second browser Dexie DB for synced conversations
- a backend-switching `ConversationStore` abstraction built only to support DB splitting
- a manual local→sync copy/import pipeline unless the single-DB spike proves it is required
- Dexie Cloud built-in end-user login UI
- collaborative realms / members / shared editing between multiple users
- continuing the public session in place from `/share/$sessionId`
- structured transcript import instead of markdown seeding
- background/service-worker sync for v1
- hot-swapping an already-open singleton DB from local mode into cloud mode without a reload
- using Dexie eval → prod as the app-level product model

---

# final recommendation

The cleanest plan is:

1. **Keep one browser `AppDb`**
   - keep one local-first DB in the browser
   - sync only `sessions` + `messages`
   - keep runtime, keys, settings, repos, and cost metadata local-only via `unsyncedTables`

2. **Make sync paid-only and local-first by default**
   - free and signed-out users stay purely local
   - paid users boot with Dexie Cloud enabled
   - free users never connect to Dexie Cloud or count toward Dexie user quota

3. **Use an explicit app token route, not the Better Auth browser plugin**
   - browser helper calls `/api/dexie-cloud-token`
   - server verifies Better Auth session + `ghId`
   - server checks `isSyncEntitled()`
   - token minting stays server-side and keeps `public_key` intact

4. **Switch into cloud mode only at boot time**
   - decide `syncEnabled` before first normal DB use when possible
   - free → paid upgrade persists a flag and reloads into cloud mode
   - do not hot-swap an already-open singleton DB from local to cloud mode

5. **Delete fake bootstrap side effects**
   - remove `/api/dexie-cloud-bootstrap` from the sync flow
   - do not hide billing/tier mutations inside bootstrap
   - if Dexie user reconciliation is still needed later, move it to billing lifecycle / webhook code

6. **Keep sharing on a dedicated `/share/$sessionId` route**
   - read-only published transcript
   - public snapshot tables in `rlm-public`
   - owner metadata in private `shareOwners`
   - submit from the shared page starts a new private conversation

7. **Keep the v1 share fork boring**
   - reuse the current markdown export model
   - include tool results for fidelity
   - enforce a hard size cap before seeding the next prompt

This keeps the implementation incremental, minimizes blast radius, preserves GitInspect’s local-first model, and removes the plugin / eval / bootstrap confusion from the sync architecture.
