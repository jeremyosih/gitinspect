import { createFileRoute } from "@tanstack/react-router"
import type { RepoSource } from "@/types/storage"
import { Chat } from "@/components/chat"

type RepoSplatSearch = {
  q?: string
}

export const Route = createFileRoute("/$owner/$repo/$")({
  validateSearch: (search: RepoSplatSearch) => ({
    q:
      typeof search.q === "string" && search.q.trim().length > 0
        ? search.q
        : undefined,
  }),
  component: RepoChatRoute,
})

function RepoChatRoute() {
  const params = Route.useParams()
  const repoSource: RepoSource = {
    owner: params.owner,
    ref: params._splat ?? "",
    repo: params.repo,
  }

  return <Chat repoSource={repoSource} />
}
