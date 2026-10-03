import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig } from "vitest/config";

function fromRoot(path: string) {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@/lib/sharing-service.server",
        replacement: fromRoot("./apps/web/src/lib/sharing-service.server.ts"),
      },
      {
        find: "libfx/fx-core.wasm?url",
        replacement:
          fileURLToPath(
            new URL(
              "./fx-core.wasm",
              pathToFileURL(createRequire(import.meta.url).resolve("libfx/browser")),
            ),
          ) + "?url",
      },
      {
        find: "@/components/root-guard",
        replacement: fromRoot("./apps/web/src/components/root-guard.tsx"),
      },
      {
        find: "@/components/auth-callback-page",
        replacement: fromRoot("./apps/web/src/components/auth-callback-page.tsx"),
      },
      {
        find: "@/components/analytics",
        replacement: fromRoot("./apps/web/src/components/analytics.tsx"),
      },
      {
        find: "@/components/app-auth-provider",
        replacement: fromRoot("./apps/web/src/components/app-auth-provider.tsx"),
      },
      {
        find: "@/components/app-header",
        replacement: fromRoot("./apps/web/src/components/app-header.tsx"),
      },
      {
        find: "@/components/app-sidebar",
        replacement: fromRoot("./apps/web/src/components/app-sidebar.tsx"),
      },
      {
        find: "@/components/auth-dialog-wrapper",
        replacement: fromRoot("./apps/web/src/components/auth-dialog-wrapper.tsx"),
      },
      {
        find: "@/components/feedback-dialog",
        replacement: fromRoot("./apps/web/src/components/feedback-dialog.tsx"),
      },
      {
        find: "@/components/pricing-settings-panel",
        replacement: fromRoot("./apps/web/src/components/pricing-settings-panel.tsx"),
      },
      {
        find: "@/components/sync-bootstrap-gate",
        replacement: fromRoot("./apps/web/src/components/sync-bootstrap-gate.tsx"),
      },
      {
        find: "@/components/chat-adapter",
        replacement: fromRoot("./packages/runtime/src/lib/chat-adapter.ts"),
      },
      {
        find: "@/components/ui",
        replacement: fromRoot("./packages/ui/src/components"),
      },
      {
        find: "@/hooks/use-mobile",
        replacement: fromRoot("./packages/ui/src/hooks/use-mobile.ts"),
      },
      {
        find: "@/lib/auth-client",
        replacement: fromRoot("./apps/web/src/lib/auth-client.ts"),
      },
      {
        find: "@/lib/github-access",
        replacement: fromRoot("./apps/web/src/lib/github-access.ts"),
      },
      {
        find: "@/lib/feedback.server",
        replacement: fromRoot("./apps/web/src/lib/feedback.server.ts"),
      },
      {
        find: "@/middleware/auth",
        replacement: fromRoot("./apps/web/src/middleware/auth.ts"),
      },
      {
        find: "@/store/auth-store",
        replacement: fromRoot("./apps/web/src/store/auth-store.ts"),
      },
      { find: "@/lib/github/cache", replacement: fromRoot("./packages/vfs/src/cache.ts") },
      {
        find: "@/lib/github/github-fs",
        replacement: fromRoot("./packages/vfs/src/github-fs.ts"),
      },
      { find: "@/lib/github/refs", replacement: fromRoot("./packages/vfs/src/refs.ts") },
      { find: "@/lib/github/types", replacement: fromRoot("./packages/vfs/src/types.ts") },
      { find: "@/lib/github", replacement: fromRoot("./packages/vfs/src/index.ts") },
      { find: "@/lib/utils", replacement: fromRoot("./packages/ui/src/lib/utils.ts") },
      { find: "@/types/storage", replacement: fromRoot("./packages/db/src/types.ts") },
      { find: "@/agent", replacement: fromRoot("./packages/runtime/src/agent") },
      { find: "@/auth", replacement: fromRoot("./packages/runtime/src/auth") },
      { find: "@/components", replacement: fromRoot("./packages/ui/src/components") },
      { find: "@/db", replacement: fromRoot("./packages/db/src") },
      { find: "@/hooks", replacement: fromRoot("./packages/runtime/src/hooks") },
      { find: "@/lib", replacement: fromRoot("./packages/runtime/src/lib") },
      { find: "@/models", replacement: fromRoot("./packages/runtime/src/models") },
      { find: "@/features", replacement: fromRoot("./apps/web/src/features") },
      { find: "@/navigation", replacement: fromRoot("./apps/web/src/navigation") },
      { find: "@/proxy", replacement: fromRoot("./packages/runtime/src/proxy") },
      { find: "@/repo", replacement: fromRoot("./packages/runtime/src/repo") },
      { find: "@/routes", replacement: fromRoot("./apps/web/src/routes") },
      { find: "@/sessions", replacement: fromRoot("./packages/runtime/src/sessions") },
      { find: "@/tools", replacement: fromRoot("./packages/runtime/src/tools") },
      { find: "@/types", replacement: fromRoot("./packages/runtime/src/types") },
      { find: "@/test", replacement: fromRoot("./tests/lib") },
      { find: "@/just-github", replacement: fromRoot("./packages/vfs/src") },
      {
        find: /^@gitinspect\/db$/,
        replacement: fromRoot("./packages/db/src/index.ts"),
      },
      {
        find: "@gitinspect/shared/feedback",
        replacement: fromRoot("./packages/shared/src/feedback.ts"),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "packages/vfs/tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
