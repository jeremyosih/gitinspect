import * as React from "react"
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  retainSearchParams,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"
import { TanStackDevtools } from "@tanstack/react-devtools"
import appCss from "../styles.css?url"
import {
  AppSettingsDialog,
} from "@/components/settings-dialog"
import { AppHeader } from "@/components/app-header"
import { AppSidebar } from "@/components/app-sidebar"
import { AuthGate } from "@/components/root-guard"
import { parseSettingsSection } from "@/navigation/search-state"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/theme-provider"


type RootSearchInput = {
  settings?: string
  sidebar?: string
}

export const Route = createRootRoute({
  validateSearch: (search: RootSearchInput) => ({
    settings: parseSettingsSection(search.settings),
    sidebar: search.sidebar === "open" ? "open" : undefined,
  }),
  search: {
    middlewares: [retainSearchParams(["settings", "sidebar"])],
  },
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "gitinspect.com",
      },
      {
        name: "description",
        content:
          "Client-side Sitegeist Web v0 with local sessions, provider auth, streaming chat, and cost tracking.",
      },
      {
        name: "apple-mobile-web-app-title",
        content: "Git Inspect",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/png",
        href: "/favicon-96x96.png",
        sizes: "96x96",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon.svg",
      },
      {
        rel: "shortcut icon",
        href: "/favicon.ico",
      },
      {
        rel: "apple-touch-icon",
        sizes: "180x180",
        href: "/apple-touch-icon.png",
      },
      {
        rel: "manifest",
        href: "/site.webmanifest",
      },
    ],
  }),
  notFoundComponent: NotFoundPage,
  shellComponent: RootDocument,
  component: RootLayout,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            {children}
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}

function RootLayout() {
  const navigate = useNavigate()
  const search = Route.useSearch()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (pathname === "/auth/callback") {
    return <Outlet />
  }

  const isLandingPage = pathname === "/"

  return (
    <SidebarProvider
      onOpenChange={(open) => {
        void navigate({
          search: (prev) => ({
            ...prev,
            sidebar: open ? "open" : undefined,
          }),
          to: ".",
        })
      }}
      open={search.sidebar === "open"}
    >
      <div className="relative flex h-svh w-full overflow-hidden overscroll-none">
        <AppSidebar />
        <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <AppHeader />
          <main className="flex min-h-0 flex-1 overflow-hidden">
            {isLandingPage ? <Outlet /> : <AuthGate><Outlet /></AuthGate>}
          </main>
        </SidebarInset>
      </div>
      <AppSettingsDialog />
    </SidebarProvider>
  )
}

function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-medium">Page not found</h1>
      <p className="max-w-md text-xs text-muted-foreground">
        The route does not exist or the dev server reloaded while the router was
        resolving the page.
      </p>
      <Link
        className="text-xs underline underline-offset-4 hover:text-foreground"
        search={{
          tab: undefined,
          settings: undefined,
          sidebar: undefined,
        }}
        to="/"
      >
        Go back home
      </Link>
    </div>
  )
}
