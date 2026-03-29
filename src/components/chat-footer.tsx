import { Link, useSearch } from "@tanstack/react-router"
import { Icons } from "@/components/icons"
import { SidebarMobileActions } from "@/components/sidebar-mobile-actions"
import { parseSettingsSection } from "@/navigation/search-state"

export function ChatFooter() {
  const search = useSearch({ strict: false })
  return (
    <div className="space-y-1 p-2">
      <Link
        className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:underline"
        search={{
          settings: parseSettingsSection(search.settings),
          sidebar:
            search && search.sidebar === "open" ? "open" : undefined,
          tab: undefined,
        }}
        to="/"
      >
        <Icons.home className="h-4 w-4 text-sidebar-foreground" />
        <span>Home</span>
      </Link>
      <SidebarMobileActions />
    </div>
  )
}
