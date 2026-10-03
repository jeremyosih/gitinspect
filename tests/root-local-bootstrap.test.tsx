import * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const appAuthProviderMock = vi.fn(({ children }: { children: React.ReactNode }) => children);

vi.mock("@tanstack/react-router", () => ({
  HeadContent: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  Outlet: () => null,
  Scripts: () => null,
  createRootRoute: (options: unknown) => ({
    ...(options as Record<string, unknown>),
    useLoaderData: () => ({
      isSignedIn: true,
    }),
    useSearch: () => ({}),
  }),
  retainSearchParams: () => undefined,
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ routeId: "/" }),
}));

vi.mock("@vercel/analytics/react", () => ({
  Analytics: () => null,
}));

vi.mock("@gitinspect/env/web", () => ({
  env: {
    VITE_BETTER_AUTH_URL: "https://example.com",
  },
}));

vi.mock("@/components/app-auth-provider", () => ({
  AppAuthProvider: appAuthProviderMock,
}));

vi.mock("@/components/analytics", () => ({
  Analytics: () => null,
}));
vi.mock("@/components/app-header", () => ({
  AppHeader: () => null,
}));
vi.mock("@/components/app-sidebar", () => ({
  AppSidebar: () => null,
}));
vi.mock("@/components/auth-dialog-wrapper", () => ({
  AuthDialogWrapper: () => null,
}));
vi.mock("@/components/feedback-dialog", () => ({
  FeedbackDialog: () => null,
}));
vi.mock("@/components/root-guard", () => ({
  RootGuard: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/navigation/search-state", () => ({
  parseSettingsSection: () => undefined,
}));
vi.mock("@gitinspect/ui/components/data-settings", () => ({
  DataSettings: () => null,
}));
vi.mock("@gitinspect/ui/components/sidebar", () => ({
  SidebarInset: ({ children }: { children: React.ReactNode }) => children,
  SidebarProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@gitinspect/ui/components/settings-dialog", () => ({
  AppSettingsDialog: () => null,
}));
vi.mock("@gitinspect/ui/components/theme-provider", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@gitinspect/ui/components/sonner", () => ({
  Toaster: () => null,
}));
vi.mock("@gitinspect/ui/components/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe("BootstrappedRootApp", () => {
  it("mounts local auth immediately without waiting for cloud sync", async () => {
    const { BootstrappedRootApp } = await import("../apps/web/src/routes/__root");

    render(<BootstrappedRootApp />);

    expect(appAuthProviderMock).toHaveBeenCalled();
  });
});
