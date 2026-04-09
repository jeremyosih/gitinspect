import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
type ProviderKeyRecord = {
  provider: string;
  value: string;
};

const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();

const state = vi.hoisted(() => ({
  providerKeys: [] as ProviderKeyRecord[],
  settingsRows: [] as Array<{ key: string; value: string }>,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: toastSuccess,
    warning: toastWarning,
  },
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (query: () => unknown) => query(),
}));

vi.mock("@gitinspect/db", () => ({
  db: {
    providerKeys: {
      toArray: () => state.providerKeys,
    },
    settings: {
      where: () => ({
        anyOf: () => ({
          toArray: () => state.settingsRows,
        }),
      }),
    },
  },
}));

vi.mock("@gitinspect/pi/models/provider-registry", () => ({
  getProviderGroupMetadata: (provider: string) => ({
    label:
      provider === "anthropic"
        ? "Anthropic"
        : provider === "github-copilot"
          ? "GitHub Copilot"
          : provider === "google-gemini-cli"
            ? "Google Gemini CLI"
            : provider === "openai-codex"
              ? "OpenAI Codex"
              : provider,
  }),
  getSortedApiKeyProvidersForSettings: () => [] as string[],
}));

vi.mock("@gitinspect/pi/proxy/settings", () => ({
  DEFAULT_PROXY_URL: "https://proxy.example/proxy",
  PROXY_ENABLED_KEY: "proxy-enabled",
  PROXY_URL_KEY: "proxy-url",
  proxyConfigFromSettingsRows: () => ({
    enabled: true,
    url: "https://proxy.example/proxy",
  }),
}));

vi.mock("@gitinspect/pi/auth/oauth-types", () => ({
  isOAuthCredentials: (value: string) => value.trim().startsWith("{"),
}));

vi.mock("@gitinspect/pi/auth/auth-service", () => ({
  disconnectProvider: async (provider: string) => {
    state.providerKeys = state.providerKeys.filter((record) => record.provider !== provider);
  },
  getOAuthProviderName: (provider: string) => {
    switch (provider) {
      case "anthropic":
        return "Anthropic (Claude Pro/Max)";
      case "github-copilot":
        return "GitHub Copilot";
      case "google-gemini-cli":
        return "Google Gemini";
      case "openai-codex":
        return "OpenAI Codex";
      default:
        return provider;
    }
  },
  importOAuthCredentialsForProvider: async (provider: string, value: string) => {
    const credentials = JSON.parse(value) as {
      access: string;
      accountId?: string;
      expires: number;
      projectId?: string;
      providerId: string;
      refresh: string;
    };

    if (credentials.providerId !== provider) {
      const actualName =
        provider === "anthropic"
          ? "GitHub Copilot"
          : credentials.providerId === "github-copilot"
            ? "GitHub Copilot"
            : credentials.providerId;
      const expectedName = provider === "anthropic" ? "Anthropic (Claude Pro/Max)" : provider;
      throw new Error(
        `This code is for ${actualName}. Paste it into the ${expectedName} row instead.`,
      );
    }

    state.providerKeys = [
      ...state.providerKeys.filter((record) => record.provider !== provider),
      {
        provider,
        value,
      },
    ];

    return credentials;
  },
  setProviderApiKey: vi.fn(),
}));

vi.mock("@gitinspect/ui/components/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: "button" | "submit" | "reset";
  }) =>
    React.createElement(
      "button",
      {
        disabled,
        onClick,
        type: type ?? "button",
      },
      children,
    ),
}));

vi.mock("@gitinspect/ui/components/input", () => ({
  Input: ({ value, onChange, placeholder, type }: React.ComponentProps<"input">) =>
    React.createElement("input", { onChange, placeholder, type, value }),
}));

vi.mock("@gitinspect/ui/components/textarea", () => ({
  Textarea: ({ value, onChange, placeholder }: React.ComponentProps<"textarea">) =>
    React.createElement("textarea", { onChange, placeholder, value }),
}));

vi.mock("@gitinspect/ui/components/item", () => {
  const Passthrough = ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", undefined, children);

  return {
    Item: Passthrough,
    ItemActions: Passthrough,
    ItemContent: Passthrough,
    ItemDescription: Passthrough,
    ItemTitle: Passthrough,
  };
});

describe("provider settings", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
    toastWarning.mockReset();
    state.providerKeys = [];
    state.settingsRows = [];

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a provider-specific CLI connect flow and copies the command", async () => {
    const { ProviderSettings } = await import("@/components/provider-settings");
    const { rerender } = render(React.createElement(ProviderSettings));

    fireEvent.click(screen.getAllByRole("button", { name: "Connect with CLI" })[0]);
    rerender(React.createElement(ProviderSettings));

    expect(screen.getByText("Connect with login code")).toBeTruthy();
    expect(screen.getByText("npx @gitinspect/cli login -p anthropic")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy command" }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "npx @gitinspect/cli login -p anthropic",
      );
      expect(toastSuccess).toHaveBeenCalledWith("Command copied");
    });
  });

  it("imports a pasted provider code and updates the provider row", async () => {
    const { ProviderSettings } = await import("@/components/provider-settings");
    const { rerender } = render(React.createElement(ProviderSettings));

    fireEvent.click(screen.getAllByRole("button", { name: "Connect with CLI" })[1]);
    rerender(React.createElement(ProviderSettings));

    fireEvent.change(
      screen.getByPlaceholderText("Paste the code from npx @gitinspect/cli login -p copilot"),
      {
        target: {
          value: JSON.stringify({
            access: "copilot-access",
            expires: Date.now() + 60_000,
            providerId: "github-copilot",
            refresh: "copilot-refresh",
          }),
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    rerender(React.createElement(ProviderSettings));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Connected to GitHub Copilot");
    });
    rerender(React.createElement(ProviderSettings));
    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0);
  });

  it("shows an inline error when the pasted code belongs to another provider", async () => {
    const { ProviderSettings } = await import("@/components/provider-settings");
    const { rerender } = render(React.createElement(ProviderSettings));

    fireEvent.click(screen.getAllByRole("button", { name: "Connect with CLI" })[0]);
    rerender(React.createElement(ProviderSettings));

    fireEvent.change(
      screen.getByPlaceholderText("Paste the code from npx @gitinspect/cli login -p anthropic"),
      {
        target: {
          value: JSON.stringify({
            access: "copilot-access",
            expires: Date.now() + 60_000,
            providerId: "github-copilot",
            refresh: "copilot-refresh",
          }),
        },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(
      await screen.findByText(
        "This code is for GitHub Copilot. Paste it into the Anthropic (Claude Pro/Max) row instead.",
      ),
    ).toBeTruthy();
  });

  it("shows connected providers from stored oauth credentials", async () => {
    state.providerKeys = [
      {
        provider: "openai-codex",
        value: JSON.stringify({
          access: "access",
          accountId: "acct-1",
          expires: Date.now() + 60_000,
          providerId: "openai-codex",
          refresh: "refresh",
        }),
      },
    ];

    const { ProviderSettings } = await import("@/components/provider-settings");

    render(React.createElement(ProviderSettings));

    expect(screen.getAllByText("Connected").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
  });
});
