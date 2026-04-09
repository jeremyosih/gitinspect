# optimise plan — faster first token without proxy work

## purpose

Reduce time-to-first-token for the first send, especially on cold starts and repo chats, without moving usage accounting into the proxy.

This plan keeps the architecture simple:

- make the UI navigate sooner
- make billing data warm before the user clicks send
- remove GitHub OAuth token resolution from the repo-chat hot path
- move usage tracking out of the hot path

## decisions locked in

1. **Do not move usage checks/tracking into the proxy in this plan.**
2. **Do not store a bare `customerId` in Dexie as a primary optimization.** `useCustomer` warmup is the real win.
3. **Store the GitHub OAuth access token in Dexie** because GitHub OAuth app tokens are long-lived and we already accept Dexie-backed token storage for PATs.
4. **Use session storage, not Dexie, for first-send navigation handoff state.** That state is tab-local and ephemeral.

---

## current problems

### first send is too serialized

Today the first send path in `packages/ui/src/components/chat.tsx` does too much before the user lands in the session route:

1. entitlement check
2. create session
3. start initial turn
4. track usage
5. navigate
6. refresh entitlement

That means the user waits on work that does not need to block route transition.

### signed-in billing data is not treated as an explicit warm dependency

`useSubscription()` currently mounts `useCustomer()` high in the tree, which helps, but that warmup is implicit and tied to unrelated UI concerns.

### repo chats still have token resolution on the hot path

Repo chats still need GitHub access resolution near turn start. Even if the token is stable for a long time, the app still pays resolution cost at the worst possible moment.

### usage tracking still blocks too much of the happy path

Tracking is correct, but it does not need to sit in the critical path for first navigation and first visible streaming state.

---

# phase 1 — shorten the first-send critical path

## goal

Make the user land in the new chat session immediately after session creation, then start the turn from the destination route.

## target flow

### current

```text
click send
→ ensure entitlement
→ create session
→ start initial turn
→ track usage
→ navigate
```

### target

```text
click send
→ ensure entitlement
→ create session
→ persist pending first-send intent in sessionStorage
→ navigate immediately to /chat/$sessionId
→ destination route consumes pending intent
→ start initial turn
→ background usage tracking
```

## why sessionStorage

The first-send handoff is:

- tab-local
- short-lived
- not real app data
- not something another tab should ever consume

So it should not live in Dexie.

## implementation sketch

Add a small helper, likely new file:

- `apps/web/src/store/pending-first-send.ts`

Suggested shape:

```ts
type PendingFirstSend = {
  id: string;
  sessionId: string;
  content: string;
  createdAt: number;
  status: "pending" | "starting";
};
```

Rules:

- write intent after session creation succeeds
- include a short TTL, e.g. 60 seconds
- only consume when route session id matches
- only consume once
- if the session already has messages or an active local turn, clear the intent and noop

## files to change

- `packages/ui/src/components/chat.tsx`
- new `apps/web/src/store/pending-first-send.ts`
- possibly a small hook in `packages/pi/src/hooks/` or `apps/web/src/hooks/`

## acceptance criteria

- first send navigates immediately after session creation
- starting the initial turn is owned by the destination session route
- re-renders do not duplicate the first send
- pending first-send state never leaks across tabs

---

# phase 2 — make billing data explicitly warm

## goal

Make `ensureMessageEntitlement()` hit a warm cache in the normal signed-in case.

## important note

`useSubscription()` already causes `useCustomer()` to run in the root layout for signed-in users. That is helpful, but it is implicit.

We should make billing warmup an explicit concern so TTFT does not depend on a pricing-label hook remaining mounted forever.

## plan

Add a small warmup component under `AutumnProvider`, likely near:

- `apps/web/src/routes/__root.tsx`
- or `apps/web/src/components/app-auth-provider.tsx`

This component should:

- watch auth readiness
- when signed in, mount the same `useCustomer()` query used by the chat guard
- use the same `staleTime` and `refetchOnWindowFocus` policy
- run on:
  - normal app boot with restored session
  - sign in
  - signup completion

## what not to do

Do **not** add a `customerId`-only settings cache for this phase.

That does not solve the real problem because entitlement depends on the full customer/subscription state, not just the id.

## files to change

- `apps/web/src/routes/__root.tsx`
- or `apps/web/src/components/app-auth-provider.tsx`
- `packages/ui/src/hooks/use-chat-send-guards.ts`
- possibly a new `apps/web/src/components/autumn-warmup.tsx`

## acceptance criteria

- signed-in users usually do not see a cold `useCustomer()` fetch when they click send
- `ensureMessageEntitlement()` becomes a fast cache read in the happy path
- billing warmup is explicit and no longer piggybacks on unrelated subscription UI

---

# phase 3 — add GitHub OAuth token cache in Dexie

## goal

Remove GitHub OAuth access token resolution from the repo-chat hot path when the token is already known and valid.

## storage approach

Use the existing settings table first to avoid schema churn.

Suggested key:

- `github.oauth.cache`

Suggested value:

```ts
type GithubOAuthCache = {
  userId: string;
  token: string;
  scopes: string[];
  updatedAt: string;
};
```

## cache rules

Use the cached token only when:

- there is a signed-in user
- the signed-in user id matches `cache.userId`
- required scopes are present
- the cache entry still exists

## read path

In `apps/web/src/lib/github-access.ts`:

1. resolve current signed-in user
2. check Dexie cache first
3. if cache is valid, return it immediately
4. if cache miss, call `authClient.getAccessToken()`
5. persist successful result back to Dexie

## prewarm strategy

Warm the OAuth token cache when it is likely to matter:

- after successful sign in if repo features are active
- after GitHub link/relink
- after repo-scope grant completion
- when entering a repo-backed chat flow

The important thing is that repo-chat turn start should not need to fetch the token from scratch in the normal case.

## invalidation rules

Clear the cached OAuth token on:

- sign out
- account switch
- GitHub unlink/relink
- repo-scope grant changes
- any GitHub 401 or 403 using that token
- explicit token reset if we add one later

## security model

This is acceptable in the current app model because:

- GitHub OAuth app access tokens are long-lived
- we already store PATs in Dexie/settings
- the token is still scoped to the signed-in user and invalidated aggressively

## files to change

- `apps/web/src/lib/github-access.ts`
- `packages/pi/src/repo/github-token.ts` or a new helper such as:
  - `packages/pi/src/repo/github-oauth-cache.ts`
- `apps/web/src/components/app-auth-provider.tsx`
- possibly auth sign-out/account-switch handling code

## acceptance criteria

- repo chats use cached OAuth token in the normal case
- repo-chat hot path no longer depends on `authClient.getAccessToken()` when cache is warm
- cache is correctly invalidated on auth/scope/token failures
- cache is safely scoped to the current signed-in app user

---

# phase 4 — move usage tracking out of the hot path

## goal

Keep the entitlement check before send, but stop blocking navigation and first visible streaming state on usage tracking and entitlement refetch.

## target behavior

### keep in hot path

- `ensureMessageEntitlement()` before send

### remove from hot path

- `trackMessageUsage()`
- `refreshMessageEntitlement()`

## safe approach

After the initial turn has been successfully dispatched:

- fire `trackMessageUsage()` in the background
- do not await it before navigation or before the user sees the running session
- keep `keepalive: true`
- refetch entitlement in the background after tracking starts or completes

## optional reliability follow-up

If we later observe dropped usage events, add a tiny local outbox.

That is **not required for phase 1**. Start with background best-effort and measure first.

## files to change

- `packages/ui/src/components/chat.tsx`
- possibly a tiny helper for background billing work

## acceptance criteria

- first route transition no longer waits on usage tracking
- signed-in first send no longer waits on entitlement refresh after dispatch
- billing tracking still happens after successful send dispatch

---

# file-by-file change map

## new files likely

- `apps/web/src/store/pending-first-send.ts`
- `apps/web/src/components/autumn-warmup.tsx`
- optionally `packages/pi/src/repo/github-oauth-cache.ts`

## existing files to modify

- `packages/ui/src/components/chat.tsx`
- `packages/ui/src/hooks/use-chat-send-guards.ts`
- `apps/web/src/routes/__root.tsx`
- `apps/web/src/components/app-auth-provider.tsx`
- `apps/web/src/lib/github-access.ts`
- `packages/pi/src/repo/github-token.ts` or new OAuth-cache helper

---

# testing plan

## unit / behavior tests

### first-send handoff

- first send writes pending intent and navigates immediately
- destination route starts turn exactly once
- stale pending intent expires safely
- another tab cannot consume the first-send intent

### billing warmup

- signed-in boot warms `useCustomer()` query
- chat send guard reads warm query state in the happy path
- chat send does not show the loading toast when cache is already warm

### github oauth cache

- cache read wins over fresh token fetch when valid
- cache is keyed to the current signed-in user
- missing scope causes cache miss
- 401/403 invalidates cache
- sign out clears cache

### usage tracking

- first send no longer awaits `trackMessageUsage()` before navigation
- entitlement refresh happens in background
- tracking failure does not block chat start

## performance instrumentation

Add temporary timing logs around:

- click send
- session created
- navigation started
- destination route mounted
- turn dispatch started
- runtime row enters `phase="running"`
- first assistant stream arrives

This will let us verify whether the remaining TTFT cost is:

- route handoff
- worker cold start
- model/provider latency
- repo auth/token resolution

---

# rollout order

1. **early navigation / pending first-send handoff**
2. **background usage tracking + background entitlement refresh**
3. **explicit `useCustomer()` warmup**
4. **GitHub OAuth token cache + invalidation**
5. measure TTFT again before doing anything more invasive

---

# out of scope for this plan

- moving usage accounting into the proxy
- storing a display-only billing snapshot in Dexie
- SharedWorker / cross-tab runtime redesign
- schema changes unless the settings-table approach becomes too awkward

---

# done checklist

- [ ] first send navigates immediately after session creation
- [ ] first-send handoff is tab-local and exactly-once
- [ ] `trackMessageUsage()` is no longer on the critical path
- [ ] `refreshMessageEntitlement()` is no longer on the critical path
- [ ] billing data is explicitly warmed when auth becomes ready
- [ ] repo chats use cached GitHub OAuth token in the happy path
- [ ] GitHub OAuth cache invalidates correctly on auth/scope/token failures
- [ ] TTFT improves measurably for first send
