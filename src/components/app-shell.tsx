import * as React from "react"
import { DotOutlineIcon, GearIcon } from "@phosphor-icons/react"
import { setSetting } from "@/db/schema"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"
import { useRuntimeSession } from "@/hooks/use-runtime-session"
import { useSessionData } from "@/hooks/use-session-data"
import { useSessionList } from "@/hooks/use-session-list"
import { useSessionMessages } from "@/hooks/use-session-messages"
import { getCanonicalProvider } from "@/models/catalog"
import { formatRepoSourceLabel, setLastUsedRepoSource } from "@/repo/settings"
import { createSession, persistSessionSnapshot } from "@/sessions/session-service"
import type { SessionData } from "@/types/storage"
import { ChatThread } from "@/components/chat-thread"
import { Composer } from "@/components/composer"
import { ModelPicker } from "@/components/model-picker"
import { ProviderBadge } from "@/components/provider-badge"
import { SessionSidebar } from "@/components/session-sidebar"
import { SettingsDialog } from "@/components/settings-dialog"
import { Button } from "@/components/ui/button"

function syncSessionToUrl(sessionId: string): void {
  if (typeof window === "undefined") {
    return
  }

  const url = new URL(window.location.href)
  url.searchParams.set("session", sessionId)
  window.history.replaceState({}, "", url)
}

function persistLastUsedSessionSettings(session: Pick<
  SessionData,
  "id" | "model" | "provider" | "providerGroup" | "repoSource"
>): void {
  void setSetting("active-session-id", session.id)
  void setSetting("last-used-model", session.model)
  void setSetting("last-used-provider", session.provider)
  void setSetting(
    "last-used-provider-group",
    session.providerGroup ?? session.provider
  )
  void setLastUsedRepoSource(session.repoSource)
}

export function AppShell() {
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
    <ReadyAppShell
      initialSession={bootstrap.session}
      sessions={sessions}
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
    />
  )
}

function ReadyAppShell(props: {
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

  React.useEffect(() => {
    setSelectedSessionId(props.initialSession.id)
  }, [props.initialSession.id])

  React.useEffect(() => {
    syncSessionToUrl(selectedSessionId)
  }, [selectedSessionId])

  const setActiveSession = React.useEffectEvent(async (session: SessionData) => {
    setSelectedSessionId(session.id)
    syncSessionToUrl(session.id)
    persistLastUsedSessionSettings(session)
  })

  const runningSessionIds = props.sessions
    .filter((session) => session.isStreaming)
    .map((session) => session.id)

  return (
    <>
      <div className="flex min-h-svh bg-[radial-gradient(circle_at_top_left,rgba(13,148,136,0.08),transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.03),transparent_30%)]">
        <SessionSidebar
          activeSessionId={selectedSessionId}
          onCreateSession={async () => {
            const baseSession = activeSession ?? props.initialSession
            const nextSession = createSession({
              model: baseSession.model,
              providerGroup:
                baseSession.providerGroup ?? baseSession.provider,
              repoSource: baseSession.repoSource,
              thinkingLevel: baseSession.thinkingLevel,
            })
            await persistSessionSnapshot(nextSession)
            await setActiveSession(nextSession)
          }}
          onSelectSession={(sessionId) => {
            setSelectedSessionId(sessionId)
            syncSessionToUrl(sessionId)
            const selectedMetadata = props.sessions.find(
              (session) => session.id === sessionId
            )

            if (!selectedMetadata) {
              void setSetting("active-session-id", sessionId)
              return
            }

            persistLastUsedSessionSettings({
              id: selectedMetadata.id,
              model: selectedMetadata.model,
              provider: selectedMetadata.provider,
              providerGroup: selectedMetadata.providerGroup,
              repoSource: selectedMetadata.repoSource,
            })
          }}
          runningSessionIds={runningSessionIds}
          sessions={props.sessions}
        />
        <div className="flex min-h-svh min-w-0 flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-foreground/10 px-6 py-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                GitOverflow
              </div>
              <div className="mt-1 text-lg font-medium">
                {activeSession?.title ?? "Loading session..."}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ModelPicker
                disabled={activeSession?.isStreaming ?? false}
                model={activeSession?.model ?? props.initialSession.model}
                onChange={async (providerGroup, model) => {
                  if (!activeSession) {
                    return
                  }

                  await runtime.setModelSelection(providerGroup, model)
                  persistLastUsedSessionSettings({
                    ...activeSession,
                    model,
                    provider: getCanonicalProvider(providerGroup),
                    providerGroup,
                  })
                }}
                providerGroup={
                  activeSession?.providerGroup ??
                  activeSession?.provider ??
                  props.initialSession.providerGroup ??
                  props.initialSession.provider
                }
              />
              {activeSession ? (
                <ProviderBadge
                  provider={activeSession.provider}
                  providerGroup={
                    activeSession.providerGroup ?? activeSession.provider
                  }
                />
              ) : null}
              <div className="rounded-full border border-foreground/10 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {formatRepoSourceLabel(activeSession?.repoSource)}
              </div>
              <div
                className={
                  activeSession?.isStreaming
                    ? "flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-emerald-700"
                    : "flex items-center gap-1 rounded-full border border-foreground/10 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
                }
              >
                <DotOutlineIcon
                  weight={activeSession?.isStreaming ? "fill" : "regular"}
                />
                {activeSession?.isStreaming ? "Live" : "Idle"}
              </div>
              <Button
                onClick={() => props.setSettingsOpen(true)}
                size="icon-sm"
                variant="outline"
              >
                <GearIcon />
              </Button>
            </div>
          </header>
          <div className="min-h-0 flex-1">
            {activeSession ? (
              <ChatThread
                isStreaming={activeSession.isStreaming}
                messages={messages}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
                Loading session...
              </div>
            )}
          </div>
          <Composer
            error={runtime.error ?? activeSession?.error}
            isStreaming={activeSession?.isStreaming ?? false}
            onAbort={runtime.abort}
            onSend={runtime.send}
          />
        </div>
      </div>
      <SettingsDialog
        onOpenChange={props.setSettingsOpen}
        open={props.settingsOpen}
        onRepoSourceChange={async (repoSource) => {
          await runtime.setRepoSource(repoSource)

          if (!activeSession) {
            return
          }

          persistLastUsedSessionSettings({
            ...activeSession,
            repoSource,
          })
        }}
        session={activeSession ?? props.initialSession}
        settingsDisabled={activeSession?.isStreaming ?? false}
      />
    </>
  )
}
