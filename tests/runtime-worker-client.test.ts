import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("runtime worker client", () => {
  beforeEach(() => {
    vi.resetModules();
    Reflect.deleteProperty(globalThis, "ComlinkWorker");
  });

  it("creates the worker lazily and reuses the singleton", async () => {
    const constructorMock = vi.fn(function (
      this: unknown,
      _url: URL,
      _options: { name: string; type: "module" },
    ): Record<string, never> {
      return {};
    });

    Reflect.set(globalThis, "ComlinkWorker", constructorMock);

    const { getRuntimeWorker } = await import("@/agent/runtime-worker-client");

    expect(constructorMock).not.toHaveBeenCalled();

    const first = getRuntimeWorker();
    const second = getRuntimeWorker();

    expect(first).toBe(second);
    expect(constructorMock).toHaveBeenCalledTimes(1);
    expect(constructorMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        name: "gitinspect-runtime-worker",
        type: "module",
      }),
    );
  });

  it("reports worker availability without constructing the singleton", async () => {
    const constructorMock = vi.fn(function (
      this: unknown,
      _url: URL,
      _options: { name: string; type: "module" },
    ): Record<string, never> {
      return {};
    });

    const { getRuntimeWorkerIfAvailable } = await import("@/agent/runtime-worker-client");
    expect(getRuntimeWorkerIfAvailable()).toBeUndefined();

    Reflect.set(globalThis, "ComlinkWorker", constructorMock);
    expect(getRuntimeWorkerIfAvailable()).toEqual({});
    expect(constructorMock).toHaveBeenCalledTimes(1);
  });

  it("preserves direct ComlinkWorker syntax for vite-plugin-comlink", () => {
    const packageSource = readFileSync(
      join(process.cwd(), "packages/pi/src/agent/runtime-worker-client.ts"),
      "utf8",
    );
    const webSource = readFileSync(
      join(process.cwd(), "apps/web/src/agent/runtime-worker-client.ts"),
      "utf8",
    );

    expect(packageSource).toContain('new ComlinkWorker<typeof import("./runtime-worker")>(');
    expect(webSource).toContain('new ComlinkWorker<typeof import("./runtime-worker")>(');
    expect(packageSource).not.toContain('typeof ComlinkWorker !== "undefined"');
    expect(webSource).not.toContain('typeof ComlinkWorker !== "undefined"');
  });
});
