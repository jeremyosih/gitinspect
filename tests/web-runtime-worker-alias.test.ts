import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("web runtime worker alias", () => {
  it("routes the package runtime worker client through the web wrapper", () => {
    const configSource = readFileSync(join(process.cwd(), "apps/web/vite.config.ts"), "utf8");

    expect(configSource).toContain(
      '"@gitinspect/runtime/agent/runtime-worker-client": fileURLToPath(',
    );
    expect(configSource).toContain(
      'new URL("./src/agent/runtime-worker-client.ts", import.meta.url)',
    );
  });
});
