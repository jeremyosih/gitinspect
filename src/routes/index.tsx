import { createFileRoute } from "@tanstack/react-router"
import { LandingPage } from "@/components/landing-page"
import { parseLandingTab } from "@/navigation/search-state"

export const Route = createFileRoute("/")({
  component: HomePage,
  validateSearch: (
    search: Record<string, unknown>
  ) => ({
    tab: parseLandingTab(search.tab),
  }),
})

function HomePage() {
  return <LandingPage />
}
