import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROXY_URL } from "@/proxy/settings";

const mocks = vi.hoisted(() => ({
  deleteSetting: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

vi.mock("@gitinspect/db", () => ({
  deleteSetting: mocks.deleteSetting,
  getSetting: mocks.getSetting,
  setSetting: mocks.setSetting,
}));

describe("proxy settings", () => {
  beforeEach(() => {
    mocks.deleteSetting.mockReset();
    mocks.getSetting.mockReset();
    mocks.setSetting.mockReset();
  });

  it("returns default proxy settings when storage is empty", async () => {
    mocks.getSetting.mockResolvedValue(undefined);

    const { getProxyConfig } = await import("@/proxy/settings");

    await expect(getProxyConfig()).resolves.toEqual({
      enabled: true,
      url: DEFAULT_PROXY_URL,
    });
  });

  it("persists proxy settings locally", async () => {
    const { setProxyConfig } = await import("@/proxy/settings");

    await setProxyConfig({
      enabled: true,
      url: "https://proxy.example/proxy",
    });

    expect(mocks.setSetting).toHaveBeenCalledWith("proxy.enabled", true);
    expect(mocks.setSetting).toHaveBeenCalledWith("proxy.url", "https://proxy.example/proxy");
    expect(mocks.deleteSetting).not.toHaveBeenCalled();
  });

  it("removes the stored proxy url when cleared", async () => {
    const { setProxyConfig } = await import("@/proxy/settings");

    await setProxyConfig({
      enabled: false,
      url: "",
    });

    expect(mocks.setSetting).toHaveBeenCalledWith("proxy.enabled", false);
    expect(mocks.deleteSetting).toHaveBeenCalledWith("proxy.url");
  });
});
