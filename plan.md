# Routes Refactor Plan

## What You Actually Want

The root route should be the real layout route.

Not:

- routes building the shell themselves
- a second shell orchestration layer
- a context/provider architecture just to move props around

Yes:

- [`src/routes/__root.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/__root.tsx) renders the full app layout once
- root layout contains the sidebar, header, settings dialog, and `<Outlet />`
- route files only render page content
- components like sidebar should fetch what they need themselves instead of receiving the same props from every route

That means the direction is:

```tsx
<SidebarProvider>
  <AppSidebar />
  <SidebarInset>
    <AppHeader />
    <Outlet />
  </SidebarInset>
  <AppSettingsDialog />
</SidebarProvider>
```

## Core Refactor Goal

Refactor `src/routes` so:

1. layout is defined once in root
2. `index.tsx`, `chat.tsx`, `$owner.$repo.index.tsx`, and `$owner.$repo.$.tsx` stop mounting the shell
3. `AppSidebar` becomes self-contained and zero-prop
4. root-level UI state like `sidebar` and `settings` is managed from root
5. route files only own route-specific content and redirects

## Current Problem

Right now every route is doing this same job again:

```tsx
<AppShellLayout
  header={<ChatHeader ... />}
  main={main}
  settings={<SettingsDialog ... />}
  sidebar={<ChatSidebar ... />}
  sidebarOpen={search.sidebar === "open"}
  onSidebarOpenChange={...}
/>
```

That creates three problems:

1. shell composition is duplicated
2. root-level search state is manually re-threaded everywhere
3. components that should be smart components are being treated like dumb prop bags

The duplication is especially obvious in:

- [`src/routes/index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/index.tsx)
- [`src/routes/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/chat.tsx)
- [`src/routes/$owner.$repo.index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.index.tsx)
- [`src/routes/$owner.$repo.$.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.$.tsx)

## Target Shape

### Root owns the entire shell

The root route should render:

- `SidebarProvider`
- `AppSidebar`
- `SidebarInset`
- top header
- `Outlet`
- settings dialog

Only once.

### Routes render content only

After the refactor:

- `/` renders landing page content only
- `/chat` renders the shared `Chat` component
- `/$owner/$repo/` renders the same shared `Chat` component with repo context
- `/$owner/$repo/$` renders the same shared `Chat` component with repo context for non-main refs

## Correct Ownership Boundaries

### `__root.tsx`

Should own:

- document shell
- theme/tooltip/toaster providers
- root search validation for `settings` and `sidebar`
- root-owned search types for `settings` and `sidebar`
- the actual layout route
- sidebar open/close sync
- settings dialog open/close sync
- rendering `<Outlet />`

Should not own:

- selected session messages
- repo-specific route content
- empty chat vs active chat decisions

### `AppSidebar`

Should own:

- loading session metadata
- active session detection
- create/select/delete session actions
- persistence of last-used session settings when navigating

The key point is:

- everything the sidebar needs should live in `AppSidebar`

### `AppHeader`

Should own:

- breadcrumb rendering
- reading current route/session/repo information needed for the header
- opening settings

### `AppSettingsDialog`

Should own:

- reading root search state
- active section
- reading current selected session if needed for costs or GitHub settings

### Route files

Should own:

- route-local `session` validation
- route-local `session` search types
- invalid session redirects
- passing only minimal route context into the shared `Chat` component

Should not own:

- sidebar data
- header data
- settings dialog wiring
- shell JSX
- special repo chat view logic
- special “new chat” page logic
- loading chat messages if `Chat` can do it itself

## Proposed Component Structure

### Root layout route

The root route itself should look like this shape:

```tsx
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { AppHeader } from "@/components/app-header"
import { AppSettingsDialog } from "@/components/app-settings-dialog"

export const Route = createRootRoute({
  validateSearch: (search) => ({
    settings: isSettingsSection(search.settings) ? search.settings : undefined,
    sidebar: search.sidebar === "open" ? "open" : undefined,
  }),
  shellComponent: RootDocument,
  component: RootLayout,
})

function RootLayout() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (pathname === "/auth/callback") {
    return <Outlet />
  }

  return (
    <SidebarProvider
      onOpenChange={(open) => {
        void navigate({
          search: (prev) => ({
            ...prev,
            sidebar: open ? "open" : undefined,
          }),
        })
      }}
      open={search.sidebar === "open"}
    >
      <AppSidebar />
      <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AppHeader />
        <main className="flex min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </SidebarInset>
      <AppSettingsDialog />
    </SidebarProvider>
  )
}
```

That is the main architectural change.

No extra shell provider is needed.

## Replace `AppShellLayout`

[`src/components/app-shell-layout.tsx`](/Users/jeremy/Developer/gitinspect/src/components/app-shell-layout.tsx) should be deleted

Reason:

- root can render the layout directly
- keeping `AppShellLayout` risks preserving the current abstraction that caused the duplication in the first place

## One Chat Surface Everywhere

This is an important correction to the plan.

There should not be:

- a repo-specific chat content component
- a separate “new chat” view
- one component for empty chat and another for active chat

There should be one shared chat surface.

That means:

- [`src/components/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat.tsx) becomes the single chat UI for all chat routes
- the component must support both empty and active states
- repo routes use the same component as `/chat`
- the difference between routes is only the input data:
- optional `repoSource`
- optional search-driven inputs like `initialQuery` if that feature is needed

### What this replaces

This should replace the current split between:

- [`src/components/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat.tsx)
- [`src/components/empty-chat-content.tsx`](/Users/jeremy/Developer/gitinspect/src/components/empty-chat-content.tsx)

The “new chat” experience should not be a different product surface. It should simply be the empty state of the same `Chat` component.

### Target behavior

`/chat`

- no `session` in search
- render the normal chat layout with an empty transcript
- show the composer in-place
- first send creates the session and continues in the same chat UI

`/chat?session=...`

- render the exact same `Chat` component
- show transcript + composer

`/$owner/$repo`

- render the exact same `Chat` component
- if no session, show empty chat with repo context
- if session exists, show transcript + composer

`/$owner/$repo/$ref`

- same as above, with `repoSource.ref` taken from params

### Desired `Chat` direction

The exact API can change, but the component should move toward something like:

```tsx
type ChatProps = {
  repoSource?: RepoSource
}
```

Inside `Chat`, the component should own:

- reading `session` from router search
- loading session + messages from Dexie
- loading defaults needed for the empty-chat state
- `useRuntimeSession(session?.id)`
- navigation to `settings=github`
- empty-state rendering when `session` is missing

If the product needs an `initialQuery` behavior, prefer a search param for it rather than a prop-heavy route API.

Example direction:

```text
/chat?initialQuery=fix%20this
/$owner/$repo?initialQuery=explain%20this%20repo
```

That keeps route-to-chat handoff URL-driven instead of inventing another prop channel.

The only tricky part is first-send session creation when `session` does not exist yet.

That should be solved in the smallest possible way:

- preferred: `Chat` owns it directly
- acceptable fallback: `Chat` receives one narrowly-scoped first-send callback

What should not happen:

- a broad route-control prop API
- a separate `sessionId` prop when `session` already exists
- a `runtime` prop pushed in from routes
- a prop just to open GitHub settings
- routes loading messages only to immediately pass them into `Chat`

The important part is:

- one component
- one layout
- one empty state
- one active state
- repo support is just optional context, not a separate view

## Sidebar Refactor

### Current problem

[`src/components/chat-sidebar.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat-sidebar.tsx) currently depends on route-owned props:

```tsx
export function ChatSidebar(props: {
  activeSessionId: string
  onCreateSession: () => void
  onDeleteSession: (sessionId: string) => void
  onSelectSession: (sessionId: string) => void
  runningSessionIds: string[]
  sessions: SessionMetadata[]
}) {
  ...
}
```

This is exactly what needs to go away.

### Target

Rename it to `AppSidebar` and make it self-contained.

Example target:

```tsx
export function AppSidebar() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const sessions = useLiveQuery(async () => await listSessionMetadata(), [])

  const sessionList = sessions ?? []
  const runningSessionIds = sessionList
    .filter((session) => session.isStreaming)
    .map((session) => session.id)
  const activeSessionId =
    typeof search.session === "string" ? search.session : ""

  const handleCreateSession = () => {
    void navigate({
      to: "/chat",
      search: (prev) => ({
        ...prev,
        session: undefined,
      }),
    })
  }

  const handleSelectSession = async (sessionId: string) => {
    const session = sessionList.find((item) => item.id === sessionId)
    if (!session) return

    await persistLastUsedSessionSettings({
      model: session.model,
      provider: session.provider,
      providerGroup: session.providerGroup,
    })

    void navigate({
      ...sessionDestination({
        id: session.id,
        repoSource: session.repoSource,
      }),
      search: (prev) => ({
        ...prev,
        session: session.id,
      }),
    })
  }

  return (
    <Sidebar className="border-r-0">
      ...
    </Sidebar>
  )
}
```

The exact helper names can change, but the ownership should not.

### Important consequence

After this refactor, route files should no longer pass:

- `sessions`
- `runningSessionIds`
- `activeSessionId`
- `onCreateSession`
- `onDeleteSession`
- `onSelectSession`

into the sidebar.

## Sidebar Simplicity Rule

The sidebar should not change shape based on the current page as part of this refactor.

That means:

- no `current-route-info.ts`
- no route-scope orchestration layer
- no repo-vs-global sidebar modes

If the sidebar needs router state at all, keep it minimal:

- `useSearch({ strict: false })` for `session`
- direct router hooks for navigation

If some later behavior truly needs path params, read them directly in the component with router hooks. Do not introduce an app-wide route-info abstraction just to make the sidebar work.

## Header Refactor

`ChatHeader` should become `AppHeader` and read what it needs itself.

It should not be passed:

- `repoSource`
- `settingsDisabled`
- `onOpenSettings`

It can derive these internally:

- repo breadcrumb from current route or selected session
- settings disabled from current selected session
- settings open action via `useNavigate()`

Example shape:

```tsx
export function AppHeader() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const selectedSession = useSelectedSessionSummary(
    typeof search.session === "string" ? search.session : undefined
  )
  const params = useParams({ strict: false })

  const repoSource = selectedSession?.repoSource
    ? selectedSession.repoSource
    : "owner" in params && "repo" in params
      ? {
          owner: params.owner,
          repo: params.repo,
          ref:
            "_splat" in params && typeof params._splat === "string"
              ? params._splat
              : "main",
        }
      : undefined

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <SidebarTrigger />
        ...
      </div>
      <Button
        disabled={selectedSession?.isStreaming ?? false}
        onClick={() => {
          void navigate({
            search: (prev) => ({
              ...prev,
              settings: "providers",
            }),
          })
        }}
      />
    </header>
  )
}
```

## Settings Dialog Refactor

`SettingsDialog` should become `AppSettingsDialog`.

It should not be driven by props from route files.

Instead it should derive:

- `open`
- `section`
- selected session
- `settingsDisabled`

internally.

Example shape:

```tsx
export function AppSettingsDialog() {
  const search = useSearch({ strict: false })
  const navigate = useNavigate()
  const selectedSession = useSelectedSessionSummary(
    typeof search.session === "string" ? search.session : undefined
  )

  const section = search.settings ?? "providers"
  const open = search.settings !== undefined
  const settingsDisabled = selectedSession?.isStreaming ?? false

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        void navigate({
          search: (prev) => ({
            ...prev,
            settings: nextOpen ? section : undefined,
          }),
        })
      }}
      open={open}
    >
      ...
    </Dialog>
  )
}
```

## Search Param Strategy

### Root search params stay in root

Keep this split:

- root owns `settings`
- root owns `sidebar`
- route files own `session`

That also means the old combined app-shell search typing should go away.

[`src/routes/app-shell-search.ts`](/Users/jeremy/Developer/gitinspect/src/routes/app-shell-search.ts) is expected to become obsolete because the refactor removes the old pattern of bundling shell state and route state together.

### Use functional search updates everywhere

This is the key cleanup:

Stop doing this:

```tsx
navigate({
  search: {
    settings: search.settings,
    sidebar: search.sidebar,
    session: search.session,
  },
})
```

Do this instead:

```tsx
navigate({
  search: (prev) => ({
    ...prev,
    session: nextSessionId,
  }),
})
```

This preserves root search state without re-threading it manually.

### Simplify `navigateToSession`

[`src/sessions/session-actions.ts`](/Users/jeremy/Developer/gitinspect/src/sessions/session-actions.ts) should stop accepting shell state.

Current smell:

```ts
navigateToSession(target, {
  settings: search.settings,
  sidebar: search.sidebar,
})
```

Target:

```ts
export function sessionDestination(target: SessionRouteTarget) {
  if (target.repoSource) {
    return {
      to: "/$owner/$repo/$" as const,
      params: {
        owner: target.repoSource.owner,
        repo: target.repoSource.repo,
        _splat: target.repoSource.ref,
      },
    }
  }

  return {
    to: "/chat" as const,
  }
}
```

Then use:

```tsx
void navigate({
  ...sessionDestination(target),
  search: (prev) => ({
    ...prev,
    session: target.id,
  }),
})
```

## Route-by-Route Plan

### `src/routes/__root.tsx`

Refactor into the real layout route.

Changes:

- keep `validateSearch`
- keep `RootDocument`
- add `component: RootLayout`
- render `SidebarProvider`
- render `AppSidebar`
- render `AppHeader`
- render `<Outlet />`
- render `AppSettingsDialog`
- bypass shell for `/auth/callback`

### `src/routes/index.tsx`

After refactor this should be very small:

```tsx
export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  return <LandingPage />
}
```

Remove:

- `AppShellLayout`
- `ChatSidebar`
- `ChatHeader`
- `SettingsDialog`
- session metadata list query
- sidebar handlers
- settings handlers

### `src/routes/chat.tsx`

Keep:

- `session` validation
- invalid-session redirect
- rendering the shared `Chat` component

Remove:

- all shell imports
- all sidebar imports
- all settings dialog imports
- all session-list sidebar action code
- any route-level swap between `Chat` and a separate empty-chat page
- selected session/messages loading if `Chat` owns that directly

This file should become content-only.

### `src/routes/$owner.$repo.index.tsx`

Keep:

- repo intent for `ref: "main"`
- invalid-session redirect
- rendering the shared `Chat` component with `repoSource`

Remove:

- shell composition
- sidebar prop wiring
- settings prop wiring
- any repo-specific chat surface
- selected session/messages loading if `Chat` owns that directly

### `src/routes/$owner.$repo.$.tsx`

Same as repo index route except `ref` comes from `_splat`.

## Suggested New Small Helpers

These are small helpers, not a shell framework.

- `src/hooks/use-selected-session-summary.ts`
  - tiny Dexie helper for session metadata/session summary by `sessionId`

These are acceptable because they reduce duplication directly.

What should not be introduced:

- `AppShellProvider`
- `useConfigureAppShell`
- route registration into a shell controller

That is too much abstraction for the problem.

## Implementation Order

### Stage 1. Move the shell into root

First make [`src/routes/__root.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/__root.tsx) render the full layout route with `<Outlet />`.

Do not refactor route logic yet.

Success criteria:

- root owns the shell
- app still renders

### Stage 2. Make sidebar self-contained

Create `AppSidebar` and move into it:

- session list query
- active session detection
- create/select/delete actions

Success criteria:

- sidebar has no props
- route files no longer know how sidebar works

### Stage 3. Make header self-contained

Create `AppHeader` and move into it:

- repo breadcrumb logic
- settings-open action
- settings disabled logic

Success criteria:

- route files stop importing header

### Stage 4. Make settings dialog self-contained

Create `AppSettingsDialog` and move into it:

- `open`
- `section`
- current selected session
- GitHub token refresh callback

Success criteria:

- route files stop importing settings dialog

### Stage 5. Remove shell JSX from all routes

Shrink:

- [`src/routes/index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/index.tsx)
- [`src/routes/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/chat.tsx)
- [`src/routes/$owner.$repo.index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.index.tsx)
- [`src/routes/$owner.$repo.$.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.$.tsx)

They should only return content.

### Stage 6. Unify chat into one shared surface

- expand [`src/components/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat.tsx) so it supports empty and active states
- remove the need for a separate empty-chat screen
- make `/chat` and repo routes render the same `Chat` component
- pass `repoSource` optionally for repo-backed chat
- preserve first-send session creation from within the shared chat flow

### Stage 7. Clean up navigation helpers

Refactor session navigation to stop carrying root shell state.

## Detailed Todo List

### Phase 0. Pre-refactor audit

- [x] Re-read [`src/routes/__root.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/__root.tsx) and confirm exactly which parts must stay document-level only.
- [x] Re-read [`src/routes/index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/index.tsx) and note all shell-specific imports and handlers to remove.
- [x] Re-read [`src/routes/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/chat.tsx) and mark which logic is route content vs shell wiring.
- [x] Re-read [`src/routes/$owner.$repo.index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.index.tsx) and mark route-specific vs shell-specific code.
- [x] Re-read [`src/routes/$owner.$repo.$.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.$.tsx) and mark route-specific vs shell-specific code.
- [x] Re-read [`src/components/app-shell-layout.tsx`](/Users/jeremy/Developer/gitinspect/src/components/app-shell-layout.tsx) to confirm nothing in it needs to survive as a reusable abstraction.
- [x] Re-read [`src/components/chat-sidebar.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat-sidebar.tsx) and list every prop that must be eliminated.
- [x] Re-read [`src/components/chat-header.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat-header.tsx) and list every prop that must be eliminated.
- [x] Re-read [`src/components/settings-dialog.tsx`](/Users/jeremy/Developer/gitinspect/src/components/settings-dialog.tsx) and list every prop that must be eliminated.
- [x] Re-read [`src/sessions/session-actions.ts`](/Users/jeremy/Developer/gitinspect/src/sessions/session-actions.ts) and identify helpers that still carry root shell state.

### Phase 1. Move layout ownership to root

- [x] Add a real route component to [`src/routes/__root.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/__root.tsx), e.g. `RootLayout`.
- [x] Keep `RootDocument` focused on HTML, providers, `HeadContent`, `Scripts`, and devtools.
- [x] Keep `validateSearch` for `settings` and `sidebar` in root.
- [x] Import `Outlet` into root.
- [x] Import `SidebarProvider` and `SidebarInset` into root.
- [x] Render the full layout from root: sidebar, header, main outlet, settings dialog.
- [x] Wire sidebar open state from root search to `SidebarProvider.open`.
- [x] Wire `SidebarProvider.onOpenChange` to functional search updates in root.
- [x] Add the `/auth/callback` shell bypass in root so that route still renders plain.
- [x] Verify root is now the only route intended to own shell chrome.

### Phase 2. Create root-owned shell components

- [x] Decide final component names:
- [x] `AppSidebar`
- [x] `AppHeader`
- [x] `AppSettingsDialog`
- [x] Create or rename sidebar component file from [`src/components/chat-sidebar.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat-sidebar.tsx) to an app-level sidebar component.
- [x] Create or rename header component file from [`src/components/chat-header.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat-header.tsx) to an app-level header component.
- [x] Create or rename settings component file from [`src/components/settings-dialog.tsx`](/Users/jeremy/Developer/gitinspect/src/components/settings-dialog.tsx) to an app-level settings dialog component, or keep the file name if only the export changes.
- [x] Update all root imports to use the new component names.
- [x] Make sure none of these components require route props by the end of the phase.

### Phase 3. Make the sidebar self-contained

- [x] Remove all route-owned props from the sidebar component API.
- [x] Move the session metadata query into the sidebar component using `useLiveQuery`.
- [x] Read the active `session` directly from router search in the sidebar.
- [x] Compute `runningSessionIds` directly in the sidebar.
- [x] Move new-chat navigation logic into the sidebar.
- [x] Decide and codify the new-chat destination behavior:
- [x] sidebar new chat should go to `/chat`
- [x] it should clear `session`
- [x] it should preserve root search using functional updates
- [x] Move session-selection navigation logic into the sidebar.
- [x] Move session deletion logic into the sidebar.
- [x] Preserve `persistLastUsedSessionSettings` when selecting the next session from the sidebar.
- [x] Preserve `deleteSessionAndResolveNext` behavior when deleting from the sidebar.
- [x] Keep `ChatSessionList` unchanged initially unless the prop surface becomes awkward.
- [x] If needed, leave `ChatSessionList` prop-based but fed entirely by the sidebar component.
- [x] Update footer links in [`src/components/chat-footer.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat-footer.tsx) only if root search handling needs to switch to functional updates.

### Phase 4. Make the header self-contained

- [x] Remove `onOpenSettings` from the header props.
- [x] Remove `repoSource` from the header props.
- [x] Remove `settingsDisabled` from the header props.
- [x] Read `session` from router search inside the header.
- [x] Add a small selected-session summary hook if the header needs metadata without loading full messages.
- [x] Read path params directly inside the header if breadcrumb fallback requires owner/repo/ref.
- [x] Preserve the current breadcrumb behavior:
- [x] no repo source should show the logo/home-style breadcrumb
- [x] repo source should show owner/repo breadcrumb links
- [x] Preserve settings disabled behavior while a selected session is streaming.
- [x] Move the settings-open navigation into the header using functional search updates.
- [x] Keep the existing visual structure and button behavior unless there is a clear reason to simplify it during implementation.

### Phase 5. Make the settings dialog self-contained

- [x] Remove `open` from the settings dialog props.
- [x] Remove `section` from the settings dialog props.
- [x] Remove `onOpenChange` from the settings dialog props.
- [x] Remove `onSectionChange` from the settings dialog props.
- [x] Remove `session` from the settings dialog props.
- [x] Remove `settingsDisabled` from the settings dialog props.
- [x] Remove `onGithubTokenSaved` from the settings dialog props.
- [x] Read `settings` from root search inside the settings dialog.
- [x] Derive `open` from whether `settings` exists.
- [x] Derive current section from `search.settings ?? "providers"`.
- [x] Update open/close behavior using functional search updates.
- [x] Update section-tab changes using functional search updates.
- [x] Read selected session summary directly based on `search.session`.
- [x] Preserve costs panel behavior using the selected session.
- [x] Preserve GitHub token refresh behavior by calling `runtimeClient.refreshGithubToken(search.session)` directly when applicable.
- [x] Preserve disabling rules when the active session is streaming.

### Phase 6. Remove shell composition from routes

- [x] Remove `AppShellLayout` import from [`src/routes/index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/index.tsx).
- [x] Remove sidebar imports from [`src/routes/index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/index.tsx).
- [x] Remove header imports from [`src/routes/index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/index.tsx).
- [x] Remove settings dialog imports from [`src/routes/index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/index.tsx).
- [x] Remove session list query from [`src/routes/index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/index.tsx).
- [x] Reduce [`src/routes/index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/index.tsx) to landing-page content only.
- [x] Remove `AppShellLayout` import from [`src/routes/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/chat.tsx).
- [x] Remove sidebar/header/settings imports from [`src/routes/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/chat.tsx).
- [x] Remove session list query from [`src/routes/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/chat.tsx) if it only existed for the sidebar.
- [x] Remove sidebar create/select/delete handlers from [`src/routes/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/chat.tsx).
- [x] Remove settings open/change handlers from [`src/routes/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/chat.tsx).
- [x] Keep session validation, session loading, empty draft loading, and content rendering in [`src/routes/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/chat.tsx).
- [x] Remove `AppShellLayout` import from [`src/routes/$owner.$repo.index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.index.tsx).
- [x] Remove sidebar/header/settings imports from [`src/routes/$owner.$repo.index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.index.tsx).
- [x] Remove session list query from [`src/routes/$owner.$repo.index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.index.tsx) if it only existed for the sidebar.
- [x] Remove shell composition JSX from [`src/routes/$owner.$repo.index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.index.tsx).
- [x] Keep repo intent, selected session loading, invalid-session redirect, and content rendering in [`src/routes/$owner.$repo.index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.index.tsx).
- [x] Remove `AppShellLayout` import from [`src/routes/$owner.$repo.$.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.$.tsx).
- [x] Remove sidebar/header/settings imports from [`src/routes/$owner.$repo.$.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.$.tsx).
- [x] Remove session list query from [`src/routes/$owner.$repo.$.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.$.tsx) if it only existed for the sidebar.
- [x] Remove shell composition JSX from [`src/routes/$owner.$repo.$.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.$.tsx).
- [x] Keep repo intent, selected session loading, invalid-session redirect, and content rendering in [`src/routes/$owner.$repo.$.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.$.tsx).

### Phase 7. Unify chat into one shared surface

- [x] Rework [`src/components/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat.tsx) so it can render both empty and active chat states.
- [x] Audit the current `Chat` API and identify which props assume a session always exists.
- [x] Change the `Chat` API so routes do not need to pass session data or messages into it.
- [x] Add optional `repoSource` support to the shared `Chat` component.
- [x] Move session lookup into [`src/components/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat.tsx) by reading `search.session` directly.
- [x] Move message loading into [`src/components/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat.tsx).
- [x] Move empty-chat defaults loading into [`src/components/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat.tsx) if practical.
- [x] Remove `runtime` from the public `Chat` props and call `useRuntimeSession(session?.id)` inside `Chat`.
- [x] Remove `onOpenGithubSettings` from the public `Chat` props and navigate to `settings=github` inside `Chat`.
- [x] Do not introduce a separate `sessionId` prop if `session` is already available.
- [x] Decide the smallest solution for first-send session creation when `session` is missing.
- [x] Preferred: keep first-send behavior internal to `Chat` if practical.
- [x] Acceptable fallback: use one narrowly-scoped first-send callback rather than a broad route-control prop.
- [x] Decide whether `initialQuery` is needed as a feature.
- [x] If `initialQuery` is needed, add it as a search param rather than a direct `Chat` prop.
- [x] Preserve normal in-session send behavior for existing chats.
- [x] Preserve model selection / thinking level behavior in the shared chat UI.
- [x] Decide how suggestions should work when there is no session yet and keep that behavior inside the shared chat component.
- [x] Remove the need for a visually separate “new chat” surface.
- [x] Audit [`src/components/empty-chat-content.tsx`](/Users/jeremy/Developer/gitinspect/src/components/empty-chat-content.tsx).
- [x] Move any useful logic from [`src/components/empty-chat-content.tsx`](/Users/jeremy/Developer/gitinspect/src/components/empty-chat-content.tsx) into [`src/components/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat.tsx) if needed.
- [x] Delete [`src/components/empty-chat-content.tsx`](/Users/jeremy/Developer/gitinspect/src/components/empty-chat-content.tsx) if it becomes fully obsolete.
- [x] Update [`src/routes/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/chat.tsx) to always render [`src/components/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat.tsx).
- [x] Update [`src/routes/$owner.$repo.index.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.index.tsx) to always render [`src/components/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat.tsx).
- [x] Update [`src/routes/$owner.$repo.$.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/$owner.$repo.$.tsx) to always render [`src/components/chat.tsx`](/Users/jeremy/Developer/gitinspect/src/components/chat.tsx).
- [x] Preserve `touchRecentRepo(repoSource)` behavior in repo routes.
- [x] Preserve invalid-session redirect behavior in chat and repo routes.
- [x] Preserve “selected session belongs to another repo” redirect behavior if it is still needed after the route simplification.

### Phase 8. Simplify navigation helpers

- [x] Replace `navigateToSession` with a simpler helper such as `sessionDestination`, or rename the existing helper while simplifying it.
- [x] Remove `settings` from session navigation helper inputs.
- [x] Remove `sidebar` from session navigation helper inputs.
- [x] Update all call sites to use functional `search` updates.
- [x] Confirm the helper only decides destination path and params.
- [x] Confirm callers are responsible only for setting `session`.
- [x] Confirm no call site manually reconstructs `{ settings, sidebar, session }` anymore.

### Phase 9. Delete obsolete abstractions

- [x] Delete [`src/components/app-shell-layout.tsx`](/Users/jeremy/Developer/gitinspect/src/components/app-shell-layout.tsx).
- [x] Audit [`src/routes/app-shell-search.ts`](/Users/jeremy/Developer/gitinspect/src/routes/app-shell-search.ts) after the refactor.
- [x] Move any still-needed root search types into [`src/routes/__root.tsx`](/Users/jeremy/Developer/gitinspect/src/routes/__root.tsx) or a root-local type location.
- [x] Keep route-local `session` search typing inside the route files that use it.
- [x] Delete [`src/routes/app-shell-search.ts`](/Users/jeremy/Developer/gitinspect/src/routes/app-shell-search.ts) if it is redundant after the search type split.
- [x] Remove any unused imports left behind in routes and components.
- [x] Remove any obsolete types tied to sidebar prop threading.
- [x] Remove any obsolete types tied to settings dialog prop threading.
- [x] Remove any obsolete route-local helpers that existed only to assemble shell props.
- [x] Regenerate the route tree if the router plugin requires it after file-level changes.

### Phase 10. Verification and cleanup

- [x] Run `bun run typecheck`.
- [x] Fix all type errors introduced by component/API changes.
- [x] Run `bun run test`.
- [x] Fix any broken tests.
- [x] Run `bun run lint`.
- [ ] Fix lint errors.
- [ ] Manually test `/`.
- [ ] Manually test `/chat`.
- [ ] Manually test `/chat` with no session and confirm it looks like an empty chat, not a separate new-chat page.
- [ ] Manually test `/chat?session=<existing>`.
- [ ] Manually test `/$owner/$repo`.
- [ ] Manually test `/$owner/$repo` with no session and confirm it uses the same empty chat surface with repo context.
- [ ] Manually test `/$owner/$repo/$ref`.
- [ ] Manually test opening settings from home and chat routes.
- [ ] Manually test closing settings and preserving unrelated search params.
- [ ] Manually test sidebar open/close on desktop.
- [ ] Manually test sidebar behavior on mobile layout if possible.
- [ ] Manually test selecting a session from the sidebar.
- [ ] Manually test deleting the selected session from the sidebar.
- [ ] Manually test deleting a non-selected session from the sidebar.
- [ ] Manually test creating a new chat from the sidebar.
- [ ] Manually test `/auth/callback` to confirm it still bypasses the shell.

Phase 10 note:
- Targeted lint for the refactor surface is clean.
- Repo-wide `bun run lint` still fails on thousands of unrelated pre-existing issues in `docs/pi-mono/**`, `src/components/ui/**`, `src/db/**`, `src/models/**`, `tests/**`, and other untouched files.
- Browser QA is still blocked in this environment because the sandbox denied binding the local dev server, and the escalation request to start it outside the sandbox was rejected.

## Verification Checklist

After each stage:

1. `bun run typecheck`
2. `bun run test`
3. `bun run lint`

Manual checks:

1. `/` renders with the root layout and sidebar
2. `/chat` renders with the same root layout
3. repo routes render with the same root layout
4. creating a new chat from the sidebar goes to the correct empty route
5. selecting a session navigates correctly
6. deleting the current session falls back correctly
7. settings dialog still works from every page
8. `/auth/callback` still bypasses the shell

## Definition Of Done

This refactor is done when:

- root is the only place that renders the app layout
- route files no longer assemble the shell
- `AppSidebar` is zero-prop and self-contained
- `AppHeader` is self-contained
- `AppSettingsDialog` is self-contained
- route files are mostly content and redirects
- repo and global chat routes use one shared `Chat` surface
