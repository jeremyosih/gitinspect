import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { comlink } from "vite-plugin-comlink";
import viteTsConfigPaths from "vite-tsconfig-paths";

function createTsConfigPathsPlugin() {
  return viteTsConfigPaths({
    projects: ["./tsconfig.json"],
  });
}

function createBrowserNodeZlibAliasPlugin() {
  const replacement = fileURLToPath(new URL("./src/shims/node-zlib.ts", import.meta.url));
  type ApplyToEnvironmentArg = Parameters<NonNullable<Plugin["applyToEnvironment"]>>[0];

  return {
    applyToEnvironment(environment: ApplyToEnvironmentArg) {
      return environment.config.consumer === "client";
    },
    enforce: "pre" as const,
    name: "browser-node-zlib-alias",
    resolveId(id: string) {
      if (id === "node:zlib") {
        return replacement;
      }
      return undefined;
    },
  };
}

export default defineConfig({
  optimizeDeps: {
    include: [
      "streamdown",
      "@streamdown/cjk",
      "@streamdown/code",
      "@streamdown/math",
      "@streamdown/mermaid",
      "mermaid",
      "dayjs",
      "@braintree/sanitize-url",
    ],
  },
  plugins: [
    comlink(),
    createBrowserNodeZlibAliasPlugin(),
    nitro(),
    createTsConfigPathsPlugin(),
    tailwindcss(),
    tanstackStart({ router: { quoteStyle: "double", semicolons: true } }),
    viteReact(),
  ],
  resolve: {
    alias: {
      "@gitinspect/runtime/agent/runtime-worker-client": fileURLToPath(
        new URL("./src/agent/runtime-worker-client.ts", import.meta.url),
      ),
    },
  },
  server: {
    port: 3001,
  },
  worker: {
    format: "es",
    plugins: () => [createTsConfigPathsPlugin(), createBrowserNodeZlibAliasPlugin(), comlink()],
  },
});
