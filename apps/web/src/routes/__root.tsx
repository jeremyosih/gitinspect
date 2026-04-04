import * as React from "react";
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  retainSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { Analytics as VercelAnalytics } from "@vercel/analytics/react";
import { Analytics as OneDollarStats } from "@/components/analytics";
import appCss from "../styles.css?url";
import { AppSettingsDialog } from "@gitinspect/ui/components/settings-dialog";
import { AppHeader } from "@gitinspect/ui/components/app-header";
import { AppSidebar } from "@gitinspect/ui/components/app-sidebar";
import { FeedbackDialog } from "@/components/feedback-dialog";
import { RootGuard } from "@/components/root-guard";
import { AuthDialogWrapper } from "@/components/auth-dialog-wrapper";
import { AppAuthProvider } from "@/components/app-auth-provider";
import { parseSettingsSection } from "@/navigation/search-state";
import { SidebarInset, SidebarProvider } from "@gitinspect/ui/components/sidebar";
import { TooltipProvider } from "@gitinspect/ui/components/tooltip";
import { Toaster } from "@gitinspect/ui/components/sonner";
import { ThemeProvider } from "@gitinspect/ui/components/theme-provider";

type RootSearchInput = {
  feedback?: string;
  settings?: string;
  sidebar?: string;
};

type RootSearch = {
  feedback?: "open";
  settings?: ReturnType<typeof parseSettingsSection>;
  sidebar?: "open";
};

export const Route = createRootRoute({
  validateSearch: (search: RootSearchInput): RootSearch => ({
    feedback: search.feedback === "open" ? "open" : undefined,
    settings: parseSettingsSection(search.settings),
    sidebar: search.sidebar === "open" ? "open" : undefined,
  }),
  search: {
    middlewares: [retainSearchParams(["settings", "sidebar", "feedback"])],
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
        content: "Chat with any github repo",
      },
      {
        name: "apple-mobile-web-app-title",
        content: "gitinspect",
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
  ssr: false,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <AppAuthProvider>
              <RootGuard>{children}</RootGuard>
              <AuthDialogWrapper />
              <Toaster position="bottom-right" />
            </AppAuthProvider>
          </TooltipProvider>
        </ThemeProvider>
        <Scripts />
        <VercelAnalytics />
        <OneDollarStats />
      </body>
    </html>
  );
}

function RootLayout() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  return (
    <SidebarProvider
      onOpenChange={(open) => {
        void navigate({
          search: (prev) => ({
            ...prev,
            sidebar: open ? "open" : undefined,
          }),
          to: ".",
        });
      }}
      open={search.sidebar === "open"}
    >
      <div className="relative flex h-svh w-full overflow-hidden overscroll-none">
        <AppSidebar />
        <SidebarInset className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <AppHeader />
          <main className="flex min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </SidebarInset>
      </div>
      <AppSettingsDialog />
      <FeedbackDialog />
    </SidebarProvider>
  );
}

function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-medium">Page not found</h1>
      <p className="max-w-md text-xs text-muted-foreground">
        The route does not exist or the dev server reloaded while the router was resolving the page.
      </p>
      <Link
        className="text-xs underline underline-offset-4 hover:text-foreground"
        search={{
          tab: undefined,
          feedback: undefined,
          settings: undefined,
          sidebar: undefined,
        }}
        to="/"
      >
        Go back home
      </Link>
    </div>
  );
}
