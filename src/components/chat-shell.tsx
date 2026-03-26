import * as React from "react"
import { useRouterState } from "@tanstack/react-router"
import type { MessageRow, SessionData } from "@/types/storage"
import { runtimeClient } from "@/agent/runtime-client"
import { deleteSession } from "@/db/schema"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"
import { useRuntimeSession } from "@/hooks/use-runtime-session"
import { useSessionData } from "@/hooks/use-session-data"
import { useSessionList } from "@/hooks/use-session-list"
import { useSessionMessages } from "@/hooks/use-session-messages"
import {
  persistActiveSessionId,
  persistLastUsedSessionSettings,
  syncSessionToUrl,
} from "@/sessions/session-selection"
import { normalizeRepoSource } from "@/repo/settings"
import { parsedPathToRepoSource, parseRepoPathname } from "@/repo/url"
import {
  createSession,
  loadSession,
  persistSessionSnapshot,
} from "@/sessions/session-service"
import { Chat } from "@/components/chat"
import { ChatHeader } from "@/components/chat-header"
import { ChatSidebar } from "@/components/chat-sidebar"
import { SettingsDialog } from "@/components/settings-dialog"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

export type ChatShellMainContext = {
  activeSession: SessionData | undefined
  displayedIsStreaming: boolean
  messages: MessageRow[]
  runtime: ReturnType<typeof useRuntimeSession>
  selectedSessionId: string
}

export type ChatShellChromeProps = {
  initialSession: SessionData
  renderMain: (ctx: ChatShellMainContext) => React.ReactNode
  sessions: ReturnType<typeof useSessionList>["sessions"]
  setSettingsOpen: (open: boolean) => void
  settingsOpen: boolean
}

export function ChatShellChrome(props: ChatShellChromeProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [selectedSessionId, setSelectedSessionId] = React.useState(
    props.initialSession.id
  )
  const activeSession = useSessionData(selectedSessionId)
  const messages = useSessionMessages(selectedSessionId) ?? []
  const runtime = useRuntimeSession(selectedSessionId)
  const parsedRepoPath = parseRepoPathname(pathname)
  const sessionsInRepo = React.useMemo(() => {
    if (!parsedRepoPath) {
      return props.sessions
    }

    return props.sessions.filter((session) => {
      const source = session.repoSource
      return (
        source?.owner === parsedRepoPath.owner &&
        source?.repo === parsedRepoPath.repo
      )
    })
  }, [parsedRepoPath, props.sessions])
  const selectedSessionMetadata = props.sessions.find(
    (session) => session.id === selectedSessionId
  )
  const displayedIsStreaming =
    activeSession?.isStreaming ?? selectedSessionMetadata?.isStreaming ?? false

  React.useEffect(() => {
    setSelectedSessionId(props.initialSession.id)
  }, [props.initialSession.id])

  React.useEffect(() => {
    syncSessionToUrl(selectedSessionId)
  }, [selectedSessionId])

  React.useEffect(() => {
    if (props.sessions.length === 0) {
      return
    }

    if (props.sessions.some((session) => session.id === selectedSessionId)) {
      return
    }

    void (async () => {
      const stillExists = await loadSession(selectedSessionId)
      if (stillExists !== undefined) {
        return
      }

      const fallbackSession = props.sessions[0]

      setSelectedSessionId(fallbackSession.id)
      syncSessionToUrl(fallbackSession.id)
      void persistLastUsedSessionSettings({
        id: fallbackSession.id,
        model: fallbackSession.model,
        provider: fallbackSession.provider,
        providerGroup: fallbackSession.providerGroup,
        repoSource: fallbackSession.repoSource,
      })
    })()
  }, [props.sessions, selectedSessionId])

  const runningSessionIds = sessionsInRepo
    .filter((session) => session.isStreaming)
    .map((session) => session.id)

  const handleCreateSession = React.useEffectEvent(async () => {
    const baseSession = activeSession ?? props.initialSession
    const path =
      typeof window !== "undefined" ? window.location.pathname : ""
    const parsed = parseRepoPathname(path)
    const repoFromPath = parsed
      ? normalizeRepoSource(parsedPathToRepoSource(parsed))
      : undefined
    const nextSession = createSession({
      model: baseSession.model,
      providerGroup: baseSession.providerGroup ?? baseSession.provider,
      repoSource: repoFromPath ?? baseSession.repoSource,
      thinkingLevel: baseSession.thinkingLevel,
    })

    await persistSessionSnapshot(nextSession)
    setSelectedSessionId(nextSession.id)
    syncSessionToUrl(nextSession.id)
    await persistLastUsedSessionSettings(nextSession)
  })

  const handleSelectSession = React.useEffectEvent(async (sessionId: string) => {
    setSelectedSessionId(sessionId)
    syncSessionToUrl(sessionId)

    const selectedMetadata = props.sessions.find((session) => session.id === sessionId)

    if (!selectedMetadata) {
      await persistActiveSessionId(sessionId)
      return
    }

    await persistLastUsedSessionSettings({
      id: selectedMetadata.id,
      model: selectedMetadata.model,
      provider: selectedMetadata.provider,
      providerGroup: selectedMetadata.providerGroup,
      repoSource: selectedMetadata.repoSource,
    })
  })

  const handleDeleteSession = React.useEffectEvent(async (sessionId: string) => {
    const path =
      typeof window !== "undefined" ? window.location.pathname : ""
    const parsed = parseRepoPathname(path)
    const pool = !parsed
      ? props.sessions
      : props.sessions.filter(
          (session) =>
            session.repoSource?.owner === parsed.owner &&
            session.repoSource?.repo === parsed.repo
        )
    const remainingSessions = pool.filter(
      (session) => session.id !== sessionId
    )

    try {
      await runtimeClient.releaseSession(sessionId)
    } catch {
      // Worker unavailable or session never attached — still remove local data.
    }

    await deleteSession(sessionId)

    if (sessionId !== selectedSessionId) {
      return
    }

    if (remainingSessions.length > 0) {
      const fallbackSession = remainingSessions[0]
      setSelectedSessionId(fallbackSession.id)
      syncSessionToUrl(fallbackSession.id)
      await persistLastUsedSessionSettings({
        id: fallbackSession.id,
        model: fallbackSession.model,
        provider: fallbackSession.provider,
        providerGroup: fallbackSession.providerGroup,
        repoSource: fallbackSession.repoSource,
      })
      return
    }

    const baseSession = activeSession ?? props.initialSession
    const repoFromPathForEmpty = parsed
      ? normalizeRepoSource(parsedPathToRepoSource(parsed))
      : undefined
    const nextSession = createSession({
      model: baseSession.model,
      providerGroup: baseSession.providerGroup ?? baseSession.provider,
      repoSource: repoFromPathForEmpty ?? baseSession.repoSource,
      thinkingLevel: baseSession.thinkingLevel,
    })

    await persistSessionSnapshot(nextSession)
    setSelectedSessionId(nextSession.id)
    syncSessionToUrl(nextSession.id)
    await persistLastUsedSessionSettings(nextSession)
  })

  const mainContext: ChatShellMainContext = {
    activeSession,
    displayedIsStreaming,
    messages,
    runtime,
    selectedSessionId,
  }

  return (
    <SidebarProvider>
      <div className="relative flex h-svh w-full overflow-hidden overscroll-none">
        <ChatSidebar
          activeSessionId={selectedSessionId}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
          onSelectSession={handleSelectSession}
          runningSessionIds={runningSessionIds}
          sessions={sessionsInRepo}
        />
        <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <ChatHeader
            onOpenSettings={() => props.setSettingsOpen(true)}
            settingsDisabled={displayedIsStreaming}
          />
          <main className="flex min-h-0 flex-1 overflow-hidden">
            {props.renderMain(mainContext)}
          </main>
        </SidebarInset>
      </div>
      {activeSession ? (
        <SettingsDialog
          onOpenChange={props.setSettingsOpen}
          open={props.settingsOpen}
          session={activeSession}
          settingsDisabled={displayedIsStreaming}
        />
      ) : null}
    </SidebarProvider>
  )
}

export function ChatShell() {
  const bootstrap = useAppBootstrap()
  const { sessions } = useSessionList()
  const [settingsOpen, setSettingsOpen] = React.useState(false)

  if (bootstrap.status === "error") {
    return (
      <div className="flex min-h-svh items-center justify-center px-6 text-sm text-destructive">
        {bootstrap.error}
      </div>
    )
  }

  if (bootstrap.status === "loading" || !bootstrap.session) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading local session state...
      </div>
    )
  }

  return (
    <ChatShellChrome
      initialSession={bootstrap.session}
      sessions={sessions}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      renderMain={({
        activeSession: session,
        displayedIsStreaming,
        messages: sessionMessages,
        runtime: sessionRuntime,
      }) =>
        session ? (
          <Chat
            error={sessionRuntime.error ?? session.error}
            messages={sessionMessages}
            runtime={sessionRuntime}
            session={{
              ...session,
              isStreaming: displayedIsStreaming,
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
            Loading session...
          </div>
        )
      }
    />
  )
}
