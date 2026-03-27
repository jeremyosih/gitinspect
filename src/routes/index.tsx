import { createFileRoute } from "@tanstack/react-router"
import { LandingPage } from "@/components/landing-page"

export type LandingTab = "recent" | "suggested"

export const Route = createFileRoute("/")({
  component: HomePage,
  validateSearch: (
    search: Record<string, unknown>
  ): { tab?: LandingTab } => ({
    tab:
      search.tab === "recent" || search.tab === "suggested"
        ? search.tab
        : undefined,
  }),
})

function HomePage() {
  return <LandingPage />
}
