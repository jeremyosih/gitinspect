import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Button } from "@gitinspect/ui/components/button";
import { rememberFeedbackTrigger } from "@gitinspect/ui/lib/feedback-trigger";
import { Icons } from "@gitinspect/ui/components/icons";
import { SidebarMobileActions } from "@gitinspect/ui/components/sidebar-mobile-actions";
import { parseSettingsSection } from "@gitinspect/ui/lib/search-state";

export function ChatFooter({ showGetPro = true }: { showGetPro?: boolean } = {}) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  return (
    <div className="space-y-1 p-2">
      <Link
        className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:underline"
        search={{
          settings: parseSettingsSection(search.settings),
          sidebar: search && search.sidebar === "open" ? "open" : undefined,
          tab: undefined,
        }}
        to="/"
      >
        <Icons.home className="h-4 w-4 text-sidebar-foreground" />
        <span>Home</span>
      </Link>
      {showGetPro ? (
        <Link
          className="flex items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:underline"
          search={(prev) => ({
            ...prev,
            settings: "pricing",
          })}
          to="."
        >
          <Icons.crown className="h-4 w-4 text-sidebar-foreground" />
          <span>Get Pro</span>
        </Link>
      ) : null}
      <Button
        className="h-auto w-full justify-start px-3 py-2 text-sm font-normal text-sidebar-foreground shadow-none hover:bg-sidebar-accent"
        onClick={(event) => {
          rememberFeedbackTrigger(event.currentTarget);
          void navigate({
            search: (prev) => ({
              ...prev,
              feedback: "open",
            }),
            to: ".",
          });
        }}
        variant="ghost"
      >
        <Icons.comment className="h-4 w-4 text-sidebar-foreground" />
        <span>Feedback</span>
      </Button>
      <SidebarMobileActions />
    </div>
  );
}
