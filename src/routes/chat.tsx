import { Outlet, createFileRoute } from "@tanstack/react-router"

type ChatSearch = {
  q?: string
}

export const Route = createFileRoute("/chat")({
  validateSearch: (search: ChatSearch) => ({
    q:
      typeof search.q === "string" && search.q.trim().length > 0
        ? search.q
        : undefined,
  }),
  component: ChatRoute,
})

function ChatRoute() {
  return <Outlet />
}
