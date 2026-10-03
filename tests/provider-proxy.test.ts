import { describe, expect, it } from "vitest";
import { shouldUseProxyForProvider } from "@/agent/provider-proxy";

describe("provider-proxy", () => {
  it("does not proxy Fireworks with a real-looking key through a server-owned key", () => {
    expect(shouldUseProxyForProvider("fireworks-ai", "fw-real-key")).toBe(false);
  });
});
