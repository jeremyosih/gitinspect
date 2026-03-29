import type { MouseEvent } from "react"
import { useMemo } from "react"
import { Link } from "@tanstack/react-router"
import { subDays, startOfDay } from "date-fns"
import type { SessionData } from "@/types/storage"
import { Icons } from "@/components/icons"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { Trash2, X } from "lucide-react"
import type { SettingsSection } from "@/navigation/search-state"

type SessionRouteSearch = {
  q: string | undefined
  settings: SettingsSection | undefined
  sidebar: string | undefined
}

type SessionLinkTarget =
  | {
      search: {
        q: string | undefined
        settings: SettingsSection | undefined
        sidebar: string | undefined
      }
      to: "/chat"
    }
  | {
      params: {
        sessionId: string
      }
      search: SessionRouteSearch
      to: "/chat/$sessionId"
    }

type CategorizedSessions = {
  last30Days: SessionData[]
  last7Days: SessionData[]
  older: SessionData[]
  today: SessionData[]
  yesterday: SessionData[]
}

function getCategorizedSessions(
  sessions: SessionData[]
): CategorizedSessions {
  const todayStart = startOfDay(new Date())
  const yesterdayStart = startOfDay(subDays(new Date(), 1))
  const sevenDaysAgoStart = startOfDay(subDays(new Date(), 7))
  const thirtyDaysAgoStart = startOfDay(subDays(new Date(), 30))

  const categorized: CategorizedSessions = {
    last30Days: [],
    last7Days: [],
    older: [],
    today: [],
    yesterday: [],
  }

  for (const session of sessions) {
    const sessionDayStart = startOfDay(new Date(session.updatedAt))

    if (sessionDayStart.getTime() === todayStart.getTime()) {
      categorized.today.push(session)
      continue
    }

    if (sessionDayStart.getTime() === yesterdayStart.getTime()) {
      categorized.yesterday.push(session)
      continue
    }

    if (sessionDayStart >= sevenDaysAgoStart && sessionDayStart < yesterdayStart) {
      categorized.last7Days.push(session)
      continue
    }

    if (
      sessionDayStart >= thirtyDaysAgoStart &&
      sessionDayStart < sevenDaysAgoStart
    ) {
      categorized.last30Days.push(session)
      continue
    }

    categorized.older.push(session)
  }

  return categorized
}

function renderSessions(props: {
  activeSessionId: string
  getSessionTarget: (session: SessionData) => SessionLinkTarget
  lockedSessionIds: string[]
  onDeleteSession: (sessionId: string) => void
  onSelectSession: (
    event: MouseEvent<HTMLAnchorElement>,
    sessionId: string
  ) => void
  runningSessionIds: string[]
  sessions: SessionData[]
}) {
  return (
    <SidebarMenu>
      {props.sessions.map((session) => {
        const isRunning = props.runningSessionIds.includes(session.id)
        const isLocked = props.lockedSessionIds.includes(session.id)

        return (
          <SidebarMenuItem key={session.id}>
            <SidebarMenuButton asChild isActive={session.id === props.activeSessionId}>
              <Link
                {...props.getSessionTarget(session)}
                onClick={(event) => props.onSelectSession(event, session.id)}
              >
                <span className="truncate">{session.title}</span>
                {isLocked ? (
                  <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-amber-600">
                    Locked
                  </span>
                ) : isRunning ? (
                  <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-emerald-600">
                    Live
                  </span>
                ) : null}
              </Link>
            </SidebarMenuButton>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <SidebarMenuAction showOnHover>
                  <X className="text-sidebar-foreground" />
                  <span className="sr-only">Delete</span>
                </SidebarMenuAction>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Chat</AlertDialogTitle>
                  <AlertDialogDescription>
                    {isRunning
                      ? "This chat is still receiving a response. Deleting will stop it and remove the session. "
                      : ""}
                    Are you sure you want to delete &quot;{session.title}&quot;? This
                    action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => props.onDeleteSession(session.id)}
                  >
                    <Trash2 className="text-destructive-foreground" />
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}

export function ChatSessionList(props: {
  activeSessionId: string
  createSessionTarget: SessionLinkTarget
  getSessionTarget: (session: SessionData) => SessionLinkTarget
  lockedSessionIds: string[]
  onCreateSession: (event: MouseEvent<HTMLAnchorElement>) => void
  onDeleteSession: (sessionId: string) => void
  onSelectSession: (
    event: MouseEvent<HTMLAnchorElement>,
    sessionId: string
  ) => void
  runningSessionIds: string[]
  sessions: SessionData[]
}) {
  const categorizedSessions = useMemo(
    () => getCategorizedSessions(props.sessions),
    [props.sessions]
  )
  const categories: Array<keyof CategorizedSessions> = [
    "today",
    "yesterday",
    "last7Days",
    "last30Days",
    "older",
  ]
  const labels: Record<keyof CategorizedSessions, string> = {
    last30Days: "Last 30 Days",
    last7Days: "Last 7 Days",
    older: "Older",
    today: "Today",
    yesterday: "Yesterday",
  }

  return (
    <>
      <div className="p-2">
        <Button asChild className="h-10 w-full rounded-none bg-foreground text-primary-foreground hover:bg-foreground/90" size="lg">
          <Link {...props.createSessionTarget} onClick={props.onCreateSession}>
            <Icons.writing />
            New Chat
          </Link>
        </Button>
      </div>
      <SidebarSeparator className="mx-0" />
      <SidebarContent className="no-scrollbar overscroll-contain">
        {props.sessions.length === 0 ? (
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupLabel>Sessions</SidebarGroupLabel>
            <div className="px-2 text-xs text-muted-foreground">
              No local sessions yet.
            </div>
          </SidebarGroup>
        ) : null}
        {categories.map((category) => {
          const sessions = categorizedSessions[category]

          if (sessions.length === 0) {
            return null
          }

          return (
            <SidebarGroup
              key={category}
              className="group-data-[collapsible=icon]:hidden"
            >
              <SidebarGroupLabel>{labels[category]}</SidebarGroupLabel>
              {renderSessions({
                activeSessionId: props.activeSessionId,
                getSessionTarget: props.getSessionTarget,
                lockedSessionIds: props.lockedSessionIds,
                onDeleteSession: props.onDeleteSession,
                onSelectSession: props.onSelectSession,
                runningSessionIds: props.runningSessionIds,
                sessions,
              })}
            </SidebarGroup>
          )
        })}
      </SidebarContent>
    </>
  )
}
