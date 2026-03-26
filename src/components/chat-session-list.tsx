import { useMemo } from "react"
import { subDays, startOfDay } from "date-fns"
import type { SessionMetadata } from "@/types/storage"
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

type SessionListItem = SessionMetadata & {
  parentID?: string
}

type CategorizedSessions = {
  last30Days: SessionListItem[]
  last7Days: SessionListItem[]
  older: SessionListItem[]
  today: SessionListItem[]
  yesterday: SessionListItem[]
}

function getCategorizedSessions(
  sessions: SessionListItem[]
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

  const filteredSessions = sessions.filter((session) => session.parentID == null)

  for (const session of filteredSessions) {
    const sessionDayStart = startOfDay(new Date(session.lastModified))

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
  onDeleteSession: (sessionId: string) => void
  onSelectSession: (sessionId: string) => void
  runningSessionIds: string[]
  sessions: SessionListItem[]
}) {
  return (
    <SidebarMenu>
      {props.sessions.map((session) => {
        const isRunning = props.runningSessionIds.includes(session.id)

        return (
          <SidebarMenuItem key={session.id}>
            <SidebarMenuButton
              isActive={session.id === props.activeSessionId}
              onClick={() => props.onSelectSession(session.id)}
            >
              <span className="truncate">{session.title}</span>
              {isRunning ? (
                <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-emerald-600">
                  Live
                </span>
              ) : null}
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
  onCreateSession: () => void
  onDeleteSession: (sessionId: string) => void
  onSelectSession: (sessionId: string) => void
  runningSessionIds: string[]
  sessions: SessionMetadata[]
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
        <Button
          className="h-10 w-full rounded-none bg-foreground text-primary-foreground hover:bg-foreground/90"
          onClick={props.onCreateSession}
          size="lg"
        >
          <Icons.writing />
          New Chat
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
