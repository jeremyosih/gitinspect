import { createFileRoute } from "@tanstack/react-router"
import { ChatPage } from "@/components/new/chat-page"

export const Route = createFileRoute("/chat")({
  component: ChatRoute,
})

function ChatRoute() {
  return <ChatPage />
}
