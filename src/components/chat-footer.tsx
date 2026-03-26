import { Link } from "@tanstack/react-router"
import { Icons } from "@/components/icons"

export function ChatFooter() {
  return (
    <div className="space-y-1 p-2">
      <Link
        className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:underline"
        to="/"
      >
        <Icons.home className="h-4 w-4 text-sidebar-foreground" />
        <span>Home</span>
      </Link>
    </div>
  )
}
