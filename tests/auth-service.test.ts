import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteProviderKey = vi.fn();
const getProviderKey = vi.fn();
const setProviderKey = vi.fn();
const loginAnthropic = vi.fn();
const loginGitHubCopilot = vi.fn();
const loginGeminiCli = vi.fn();
const loginOpenAICodex = vi.fn();
const refreshAnthropic = vi.fn();
const refreshGitHubCopilot = vi.fn();
const refreshGeminiCli = vi.fn();
const refreshOpenAICodex = vi.fn();

vi.mock("@gitinspect/db", () => ({
  deleteProviderKey,
  getProviderKey,
  setProviderKey,
}));

vi.mock("@/auth/providers/anthropic", () => ({
  loginAnthropic,
  refreshAnthropic,
}));

vi.mock("@/auth/providers/github-copilot", () => ({
  loginGitHubCopilot,
  refreshGitHubCopilot,
}));

vi.mock("@/auth/providers/google-gemini-cli", () => ({
  loginGeminiCli,
  refreshGeminiCli,
}));

vi.mock("@/auth/providers/openai-codex", () => ({
  loginOpenAICodex,
  refreshOpenAICodex,
}));

describe("auth service", () => {
  beforeEach(() => {
    deleteProviderKey.mockReset();
    getProviderKey.mockReset();
    setProviderKey.mockReset();
    loginAnthropic.mockReset();
    loginGitHubCopilot.mockReset();
    loginGeminiCli.mockReset();
    loginOpenAICodex.mockReset();
    refreshAnthropic.mockReset();
    refreshGitHubCopilot.mockReset();
    refreshGeminiCli.mockReset();
    refreshOpenAICodex.mockReset();
  });

  it("persists provider api keys", async () => {
    const { setProviderApiKey } = await import("@/auth/auth-service");

    await setProviderApiKey("openai-codex", "sk-test");
    expect(setProviderKey).toHaveBeenCalledWith("openai-codex", "sk-test");
  });

  it("imports oauth credentials from a login code", async () => {
    const { importOAuthCredentials } = await import("@/auth/auth-service");
    const payload = Buffer.from(
      JSON.stringify({
        access: "access",
        expires: Date.now() + 60_000,
        projectId: "project-1",
        providerId: "google-gemini-cli",
        refresh: "refresh",
      }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    await expect(importOAuthCredentials(payload)).resolves.toEqual({
      access: "access",
      expires: expect.any(Number),
      projectId: "project-1",
      providerId: "google-gemini-cli",
      refresh: "refresh",
    });
    expect(setProviderKey.mock.calls[0]?.[0]).toBe("google-gemini-cli");
    expect(JSON.parse(String(setProviderKey.mock.calls[0]?.[1]))).toEqual({
      access: "access",
      expires: expect.any(Number),
      projectId: "project-1",
      providerId: "google-gemini-cli",
      refresh: "refresh",
    });
  });

  it("reports provider auth state from storage", async () => {
    getProviderKey.mockResolvedValue({
      provider: "openai-codex",
      updatedAt: "2026-03-23T12:00:00.000Z",
      value: '{"providerId":"openai-codex"}',
    });

    const { getProviderAuthState } = await import("@/auth/auth-service");

    await expect(getProviderAuthState("openai-codex")).resolves.toMatchObject({
      authKind: "oauth",
      hasValue: true,
      provider: "openai-codex",
    });
  });

  it("disconnects a provider", async () => {
    const { disconnectProvider } = await import("@/auth/auth-service");

    await disconnectProvider("openai-codex");
    expect(deleteProviderKey).toHaveBeenCalledWith("openai-codex");
  });

  it("forwards proxy options to oauth login and refresh", async () => {
    loginAnthropic.mockResolvedValue({
      access: "access",
      expires: Date.now() + 60_000,
      providerId: "anthropic",
      refresh: "refresh",
    });
    refreshAnthropic.mockResolvedValue({
      access: "next-access",
      expires: Date.now() + 60_000,
      providerId: "anthropic",
      refresh: "next-refresh",
    });

    const { oauthLogin, oauthRefresh } = await import("@/auth/auth-service");
    const proxyOptions = { proxyUrl: "https://proxy.example/proxy" };

    await oauthLogin("anthropic", "https://example.com/callback", undefined, proxyOptions);
    await oauthRefresh(
      {
        access: "access",
        expires: Date.now() + 60_000,
        providerId: "anthropic",
        refresh: "refresh",
      },
      proxyOptions,
    );

    expect(loginAnthropic).toHaveBeenCalledWith("https://example.com/callback", proxyOptions);
    expect(refreshAnthropic).toHaveBeenCalledWith(
      {
        access: "access",
        expires: expect.any(Number),
        providerId: "anthropic",
        refresh: "refresh",
      },
      proxyOptions,
    );
  });

  it("keeps direct oauth providers direct", async () => {
    loginOpenAICodex.mockResolvedValue({
      access: "access",
      expires: Date.now() + 60_000,
      providerId: "openai-codex",
      refresh: "refresh",
    });
    refreshOpenAICodex.mockResolvedValue({
      access: "next-access",
      expires: Date.now() + 60_000,
      providerId: "openai-codex",
      refresh: "next-refresh",
    });

    const { oauthLogin, oauthRefresh } = await import("@/auth/auth-service");
    const proxyOptions = { proxyUrl: "https://proxy.example/proxy" };

    await oauthLogin("openai-codex", "https://example.com/callback", undefined, proxyOptions);
    await oauthRefresh(
      {
        access: "access",
        expires: Date.now() + 60_000,
        providerId: "openai-codex",
        refresh: "refresh",
      },
      proxyOptions,
    );

    expect(loginOpenAICodex).toHaveBeenCalledWith("https://example.com/callback");
    expect(refreshOpenAICodex).toHaveBeenCalledWith({
      access: "access",
      expires: expect.any(Number),
      providerId: "openai-codex",
      refresh: "refresh",
    });
  });
});
