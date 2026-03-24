import * as React from "react"
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
import { createSession, persistSessionSnapshot } from "@/sessions/session-service"
import { Chat } from "@/components/new/chat"
import { ChatHeader } from "@/components/new/chat-header"
import { ChatSidebar } from "@/components/new/chat-sidebar"
import { SettingsDialog } from "@/components/settings-dialog"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import type { SessionData } from "@/types/storage"

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
    <ReadyChatShell
      initialSession={bootstrap.session}
      sessions={sessions}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
    />
  )
}

function ReadyChatShell(props: {
  initialSession: SessionData
  sessions: ReturnType<typeof useSessionList>["sessions"]
  setSettingsOpen: (open: boolean) => void
  settingsOpen: boolean
}) {
  const [selectedSessionId, setSelectedSessionId] = React.useState(
    props.initialSession.id
  )
  const activeSession = useSessionData(selectedSessionId)
  const messages = useSessionMessages(selectedSessionId) ?? []
  const runtime = useRuntimeSession(selectedSessionId)
  const selectedSessionMetadata = props.sessions.find(
    (session) => session.id === selectedSessionId
  )
  const displayedTitle =
    activeSession?.title ??
    selectedSessionMetadata?.title ??
    props.initialSession.title
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
  }, [props.sessions, selectedSessionId])

  const runningSessionIds = props.sessions
    .filter((session) => session.isStreaming)
    .map((session) => session.id)

  const handleCreateSession = React.useEffectEvent(async () => {
    const baseSession = activeSession ?? props.initialSession
    const nextSession = createSession({
      model: baseSession.model,
      providerGroup: baseSession.providerGroup ?? baseSession.provider,
      repoSource: baseSession.repoSource,
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
    const remainingSessions = props.sessions.filter((session) => session.id !== sessionId)

    await deleteSession(sessionId)

    if (sessionId !== selectedSessionId) {
      return
    }

    const fallbackSession = remainingSessions[0]

    if (fallbackSession) {
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
    const nextSession = createSession({
      model: baseSession.model,
      providerGroup: baseSession.providerGroup ?? baseSession.provider,
      repoSource: baseSession.repoSource,
      thinkingLevel: baseSession.thinkingLevel,
    })

    await persistSessionSnapshot(nextSession)
    setSelectedSessionId(nextSession.id)
    syncSessionToUrl(nextSession.id)
    await persistLastUsedSessionSettings(nextSession)
  })

  return (
    <SidebarProvider>
      <div className="relative flex min-h-screen w-full overscroll-none">
        <ChatSidebar
          activeSessionId={selectedSessionId}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
          onSelectSession={handleSelectSession}
          runningSessionIds={runningSessionIds}
          sessions={props.sessions}
        />
        <SidebarInset className="flex min-w-0 flex-1 flex-col">
          <ChatHeader
            onOpenSettings={() => props.setSettingsOpen(true)}
            title={displayedTitle}
          />
          <main className="min-h-0 flex-1">
            {activeSession ? (
              <Chat
                error={runtime.error ?? activeSession.error}
                messages={messages}
                runtime={runtime}
                session={{
                  ...activeSession,
                  isStreaming: displayedIsStreaming,
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                Loading session...
              </div>
            )}
          </main>
        </SidebarInset>
      </div>
      {activeSession ? (
        <SettingsDialog
          onOpenChange={props.setSettingsOpen}
          open={props.settingsOpen}
          onRepoSourceChange={async (repoSource) => {
            await runtime.setRepoSource(repoSource)
            await persistLastUsedSessionSettings({
              ...activeSession,
              repoSource,
            })
          }}
          session={activeSession}
          settingsDisabled={displayedIsStreaming}
        />
      ) : null}
    </SidebarProvider>
  )
}
