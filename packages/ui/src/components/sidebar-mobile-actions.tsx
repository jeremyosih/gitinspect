"use client";

import { Link } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { Icons } from "@gitinspect/ui/components/icons";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@gitinspect/ui/components/sidebar";
import { GITHUB_APP_REPO } from "@gitinspect/pi/hooks/use-github-repo-stargazers";

/** Mobile sidebar only: links and actions that are hidden from the header on small screens. Renders under the Home link. */
export function SidebarMobileActions() {
  const { setTheme, theme } = useTheme();

  return (
    <div className="md:hidden">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="h-9">
            <a href="https://x.com/dinnaiii" rel="noreferrer" target="_blank">
              <Icons.x className="text-sidebar-foreground" />
              <span>X</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="h-9 gap-1.5">
            <a
              href={`https://github.com/${GITHUB_APP_REPO.owner}/${GITHUB_APP_REPO.repo}`}
              rel="noreferrer"
              target="_blank"
            >
              <Icons.gitHub className="text-sidebar-foreground" />
              <span>GitHub</span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="h-9"
            onClick={() => (theme === "light" ? setTheme("dark") : setTheme("light"))}
          >
            <span className="relative flex size-4 shrink-0 items-center justify-center">
              <Icons.sun className="size-4 rotate-0 scale-100 text-sidebar-foreground transition-all dark:-rotate-90 dark:scale-0" />
              <Icons.moon className="absolute size-4 rotate-90 scale-0 text-sidebar-foreground transition-all dark:rotate-0 dark:scale-100" />
            </span>
            <span className="truncate">Toggle Theme</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="h-9">
            <Link
              search={(prev) => ({
                ...prev,
                settings: "providers",
              })}
              to="."
            >
              <Icons.cog className="text-sidebar-foreground" />
              <span>Settings</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  );
}
