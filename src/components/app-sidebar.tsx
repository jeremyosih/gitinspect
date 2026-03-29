import { useLiveQuery } from "dexie-react-hooks"
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router"
import type { MouseEvent } from "react"

import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { ChatFooter } from "@/components/chat-footer"
import { ChatLogo } from "@/components/chat-logo"
import { ChatSessionList } from "@/components/chat-session-list"
import { listSessionLeases, listSessions } from "@/db/schema"
import { getCurrentTabId } from "@/agent/tab-id"
import { isSessionLeaseStale } from "@/db/session-leases"
import {
  buildSessionHref,
  deleteSessionAndResolveNext,
  persistLastUsedSessionSettings,
} from "@/sessions/session-actions"

export function AppSidebar() {
  const navigate = useNavigate()
  const currentMatch = useRouterState({
    select: (state) => state.matches[state.matches.length - 1],
  })
  const search = useSearch({ strict: false })
  const sessions = useLiveQuery(async () => await listSessions(), [])
  const leases = useLiveQuery(async () => await listSessionLeases(), [])

  const sessionList = sessions ?? []
  const leaseList = leases ?? []
  const activeSessionId =
    currentMatch.routeId === "/chat/$sessionId"
      ? currentMatch.params.sessionId
      : ""
  const settings =
    typeof search.settings === "string" ? search.settings : undefined
  const sidebar = search.sidebar === "open" ? "open" : undefined
  const activeSession = sessionList.find(
    (session) => session.id === activeSessionId
  )
  const currentTabId = typeof window === "undefined" ? "" : getCurrentTabId()
  const runningSessionIds = sessionList
    .filter((session) => session.isStreaming)
    .map((session) => session.id)
  const lockedSessionIds = leaseList
    .filter(
      (lease) =>
        lease.ownerTabId !== currentTabId && !isSessionLeaseStale(lease)
    )
    .map((lease) => lease.sessionId)

  const openTargetInNewTab = (sessionId?: string) => {
    const href = sessionId ? buildSessionHref(sessionId) : "/chat"

    window.open(href, "_blank", "noopener,noreferrer")
  }

  const handleCreateSessionClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (activeSession?.isStreaming) {
      event.preventDefault()
      openTargetInNewTab()
    }
  }

  const handleSelectSession = (sessionId: string) => {
    const session = sessionList.find((item) => item.id === sessionId)

    if (!session) {
      return
    }

    if (activeSession?.isStreaming && activeSession.id !== sessionId) {
      return
    }

    void persistLastUsedSessionSettings({
      model: session.model,
      provider: session.provider,
      providerGroup: session.providerGroup,
    })
  }

  const handleSessionClick = (
    event: MouseEvent<HTMLAnchorElement>,
    sessionId: string
  ) => {
    const session = sessionList.find((item) => item.id === sessionId)

    if (!session) {
      event.preventDefault()
      return
    }

    if (activeSession?.isStreaming && activeSession.id !== sessionId) {
      event.preventDefault()
      openTargetInNewTab(sessionId)
      return
    }

    handleSelectSession(sessionId)
  }

  const handleDeleteSession = (sessionId: string) => {
    void (async () => {
      const wasSelected = sessionId === activeSessionId
      const { nextSessionId } = await deleteSessionAndResolveNext({
        sessionId,
        siblingSessions: sessionList,
      })

      if (!wasSelected) {
        return
      }

      if (!nextSessionId) {
        await navigate({
          replace: true,
          search: {
            q: undefined,
            settings,
            sidebar,
          },
          to: "/chat",
        })
        return
      }

      const nextMetadata = sessionList.find(
        (session) => session.id === nextSessionId
      )

      if (nextMetadata) {
        await persistLastUsedSessionSettings({
          model: nextMetadata.model,
          provider: nextMetadata.provider,
          providerGroup: nextMetadata.providerGroup,
        })
      }

      await navigate({
        params: {
          sessionId: nextSessionId,
        },
        replace: true,
        search: {
          q: undefined,
          settings,
          sidebar,
        },
        to: "/chat/$sessionId",
      })
    })()
  }

  return (
    <Sidebar className="border-r-0">
      <SidebarHeader className="h-14 shrink-0 justify-center border-b border-sidebar-border">
        <ChatLogo />
      </SidebarHeader>
      <ChatSessionList
        activeSessionId={activeSessionId}
        createSessionTarget={{
          search: {
            q: undefined,
            settings,
            sidebar,
          },
          to: "/chat",
        }}
        getSessionTarget={(session) => ({
          params: {
            sessionId: session.id,
          },
          search: {
            q: undefined,
            settings,
            sidebar,
          },
          to: "/chat/$sessionId",
        })}
        lockedSessionIds={lockedSessionIds}
        onCreateSession={handleCreateSessionClick}
        onDeleteSession={handleDeleteSession}
        onSelectSession={handleSessionClick}
        runningSessionIds={runningSessionIds}
        sessions={sessionList}
      />
      <SidebarFooter className="border-t border-sidebar-border">
        <ChatFooter />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
