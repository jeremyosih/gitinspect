import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import type { SessionMetadata } from "@/types/storage"
import { ChatFooter } from "@/components/chat-footer"
import { ChatLogo } from "@/components/chat-logo"
import { ChatSessionList } from "@/components/chat-session-list"

export function ChatSidebar(props: {
  activeSessionId: string
  onCreateSession: () => void
  onDeleteSession: (sessionId: string) => void
  onSelectSession: (sessionId: string) => void
  runningSessionIds: string[]
  sessions: SessionMetadata[]
}) {
  return (
    <Sidebar className="border-r-0">
      <SidebarHeader className="h-12 border-sidebar-border border-b">
        <ChatLogo />
      </SidebarHeader>
      <ChatSessionList
        activeSessionId={props.activeSessionId}
        onCreateSession={props.onCreateSession}
        onDeleteSession={props.onDeleteSession}
        onSelectSession={props.onSelectSession}
        runningSessionIds={props.runningSessionIds}
        sessions={props.sessions}
      />
      <SidebarFooter className="border-sidebar-border border-t">
        <ChatFooter />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
