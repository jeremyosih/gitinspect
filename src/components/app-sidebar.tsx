import { useLiveQuery } from "dexie-react-hooks"
import { useNavigate, useSearch } from "@tanstack/react-router"
import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { ChatFooter } from "@/components/chat-footer"
import { ChatLogo } from "@/components/chat-logo"
import { ChatSessionList } from "@/components/chat-session-list"
import { listSessions } from "@/db/schema"
import {
  deleteSessionAndResolveNext,
  persistLastUsedSessionSettings,
  sessionDestination,
} from "@/sessions/session-actions"

export function AppSidebar() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const sessions = useLiveQuery(async () => await listSessions(), [])

  const sessionList = sessions ?? []
  const activeSessionId =
    typeof search.session === "string" ? search.session : ""
  const runningSessionIds = sessionList
    .filter((session) => session.isStreaming)
    .map((session) => session.id)

  const handleCreateSession = () => {
    void navigate({
      search: (prev) => ({
        initialQuery: undefined,
        session: undefined,
        settings: prev.settings,
        sidebar: prev.sidebar,
      }),
      to: "/chat",
    })
  }

  const handleSelectSession = async (sessionId: string) => {
    const session = sessionList.find((item) => item.id === sessionId)

    if (!session) {
      return
    }

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
        initialQuery: undefined,
        session: session.id,
        settings: prev.settings,
        sidebar: prev.sidebar,
      }),
    })
  }

  const handleDeleteSession = (sessionId: string) => {
    void (async () => {
      const wasSelected = sessionId === activeSessionId
      const { nextSession } = await deleteSessionAndResolveNext({
        sessionId,
        siblingSessions: sessionList,
      })

      if (!wasSelected) {
        return
      }

      if (!nextSession) {
        await navigate({
          replace: true,
          search: (prev) => ({
            initialQuery: undefined,
            session: undefined,
            settings: prev.settings,
            sidebar: prev.sidebar,
          }),
          to: "/chat",
        })
        return
      }

      const nextMetadata = sessionList.find(
        (session) => session.id === nextSession.id
      )

      if (nextMetadata) {
        await persistLastUsedSessionSettings({
          model: nextMetadata.model,
          provider: nextMetadata.provider,
          providerGroup: nextMetadata.providerGroup,
        })
      }

      await navigate({
        ...sessionDestination(nextSession),
        replace: true,
        search: (prev) => ({
          initialQuery: undefined,
          session: nextSession.id,
          settings: prev.settings,
          sidebar: prev.sidebar,
        }),
      })
    })()
  }

  return (
    <Sidebar className="border-r-0">
      <SidebarHeader className="h-12 border-sidebar-border border-b">
        <ChatLogo />
      </SidebarHeader>
      <ChatSessionList
        activeSessionId={activeSessionId}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        onSelectSession={handleSelectSession}
        runningSessionIds={runningSessionIds}
        sessions={sessionList}
      />
      <SidebarFooter className="border-sidebar-border border-t">
        <ChatFooter />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
