import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function fromRoot(path: string) {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: [
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
        find: "@/components/feedback-dialog",
        replacement: fromRoot("./apps/web/src/components/feedback-dialog.tsx"),
      },
      {
        find: "@/components/chat-adapter",
        replacement: fromRoot("./packages/pi/src/lib/chat-adapter.ts"),
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
        find: "@/lib/feedback.server",
        replacement: fromRoot("./apps/web/src/lib/feedback.server.ts"),
      },
      { find: "@/lib/github/cache", replacement: fromRoot("./packages/just-github/src/cache.ts") },
      {
        find: "@/lib/github/github-fs",
        replacement: fromRoot("./packages/just-github/src/github-fs.ts"),
      },
      { find: "@/lib/github/refs", replacement: fromRoot("./packages/just-github/src/refs.ts") },
      { find: "@/lib/github/types", replacement: fromRoot("./packages/just-github/src/types.ts") },
      { find: "@/lib/github", replacement: fromRoot("./packages/just-github/src/index.ts") },
      { find: "@/lib/utils", replacement: fromRoot("./packages/ui/src/lib/utils.ts") },
      { find: "@/types/storage", replacement: fromRoot("./packages/db/src/storage-types.ts") },
      { find: "@/agent", replacement: fromRoot("./packages/pi/src/agent") },
      { find: "@/auth", replacement: fromRoot("./packages/pi/src/auth") },
      { find: "@/components", replacement: fromRoot("./packages/ui/src/components") },
      { find: "@/db", replacement: fromRoot("./packages/db/src") },
      { find: "@/hooks", replacement: fromRoot("./packages/pi/src/hooks") },
      { find: "@/lib", replacement: fromRoot("./packages/pi/src/lib") },
      { find: "@/models", replacement: fromRoot("./packages/pi/src/models") },
      { find: "@/features", replacement: fromRoot("./apps/web/src/features") },
      { find: "@/navigation", replacement: fromRoot("./apps/web/src/navigation") },
      { find: "@/proxy", replacement: fromRoot("./packages/pi/src/proxy") },
      { find: "@/repo", replacement: fromRoot("./packages/pi/src/repo") },
      { find: "@/routes", replacement: fromRoot("./apps/web/src/routes") },
      { find: "@/sessions", replacement: fromRoot("./packages/pi/src/sessions") },
      { find: "@/tools", replacement: fromRoot("./packages/pi/src/tools") },
      { find: "@/types", replacement: fromRoot("./packages/pi/src/types") },
      { find: "@/test", replacement: fromRoot("./tests/lib") },
      { find: "@/just-github", replacement: fromRoot("./packages/just-github/src") },
      {
        find: "@gitinspect/shared/feedback",
        replacement: fromRoot("./packages/shared/src/feedback.ts"),
      },
    ],
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "packages/just-github/tests/**/*.test.ts",
    ],
    setupFiles: ["./tests/setup.ts"],
  },
});
