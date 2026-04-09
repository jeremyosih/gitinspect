import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import type { ProviderGroupId, ProviderId } from "@gitinspect/pi/types/models";
import {
  disconnectProvider,
  getOAuthProviderName,
  importOAuthCredentialsForProvider,
  setProviderApiKey,
  type OAuthProviderId,
} from "@gitinspect/pi/auth/auth-service";
import { isOAuthCredentials } from "@gitinspect/pi/auth/oauth-types";
import { db } from "@gitinspect/db";
import {
  getProviderGroupMetadata,
  getSortedApiKeyProvidersForSettings,
} from "@gitinspect/pi/models/provider-registry";
import {
  DEFAULT_PROXY_URL,
  PROXY_ENABLED_KEY,
  PROXY_URL_KEY,
  proxyConfigFromSettingsRows,
} from "@gitinspect/pi/proxy/settings";
import { Button } from "@gitinspect/ui/components/button";
import { Input } from "@gitinspect/ui/components/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@gitinspect/ui/components/item";
import { Textarea } from "@gitinspect/ui/components/textarea";

const SUBSCRIPTION_OAUTH_PROVIDERS: OAuthProviderId[] = [
  "anthropic",
  "openai-codex",
  "github-copilot",
  "google-gemini-cli",
];

const CLI_PROVIDER_ALIASES: Record<OAuthProviderId, string> = {
  anthropic: "anthropic",
  "github-copilot": "copilot",
  "google-gemini-cli": "gemini",
  "openai-codex": "codex",
};

function sortSubscriptionOAuthByName(providers: OAuthProviderId[]): OAuthProviderId[] {
  return [...providers].sort((a, b) =>
    getOAuthProviderName(a).localeCompare(getOAuthProviderName(b), undefined, {
      sensitivity: "base",
    }),
  );
}

function isOAuthConnected(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return Boolean(trimmed && isOAuthCredentials(trimmed));
}

function apiKeyProviderLabel(provider: ProviderId): string {
  return getProviderGroupMetadata(provider as ProviderGroupId).label;
}

function hasStoredPlainApiKey(
  providerKeys: { provider: ProviderId; value: string }[],
  provider: ProviderId,
): boolean {
  const record = providerKeys.find((item) => item.provider === provider);
  const trimmed = record?.value?.trim() ?? "";
  return Boolean(trimmed && !trimmed.startsWith("{"));
}

function getCliLoginCommand(provider: OAuthProviderId): string {
  return `npx @gitinspect/cli login -p ${CLI_PROVIDER_ALIASES[provider]}`;
}

async function copyText(value: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function ProviderSettings(props: { onNavigateToProxy?: () => void }) {
  const providerKeys = useLiveQuery(() => db.providerKeys.toArray(), []) ?? [];
  const proxySettingRows = useLiveQuery(() =>
    db.settings.where("key").anyOf([PROXY_ENABLED_KEY, PROXY_URL_KEY]).toArray(),
  );

  const proxyConfig = React.useMemo(() => {
    if (proxySettingRows) {
      return proxyConfigFromSettingsRows(proxySettingRows);
    }

    return {
      enabled: true,
      url: DEFAULT_PROXY_URL,
    };
  }, [proxySettingRows]);

  const [draftValues, setDraftValues] = React.useState<Partial<Record<ProviderId, string>>>({});
  const [expandedProvider, setExpandedProvider] = React.useState<OAuthProviderId | undefined>();
  const [importValues, setImportValues] = React.useState<Partial<Record<OAuthProviderId, string>>>(
    {},
  );
  const [importErrors, setImportErrors] = React.useState<Partial<Record<OAuthProviderId, string>>>(
    {},
  );
  const [isImporting, setIsImporting] = React.useState<Partial<Record<OAuthProviderId, boolean>>>(
    {},
  );

  React.useEffect(() => {
    setDraftValues(
      Object.fromEntries(
        providerKeys.map((record) => [
          record.provider,
          record.value.trim().startsWith("{") ? "" : record.value,
        ]),
      ) as Partial<Record<ProviderId, string>>,
    );
  }, [providerKeys]);

  const apiKeyProviders = React.useMemo(() => getSortedApiKeyProvidersForSettings(), []);

  const subscriptionOAuthProviders = React.useMemo(
    () => sortSubscriptionOAuthByName(SUBSCRIPTION_OAUTH_PROVIDERS),
    [],
  );

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <div className="space-y-1.5">
          <h3 className="text-sm font-medium">Subscription Login</h3>
          <p className="text-xs text-muted-foreground">
            Connect your existing subscription in your terminal, then paste the returned code back
            here to finish setup in this browser.
          </p>
        </div>

        <div className="text-xs text-muted-foreground">
          <p>
            Requests routed through{" "}
            <span className="font-medium text-foreground">{proxyConfig.url}</span>. An untrusted
            proxy can see your credentials.{" "}
            {props.onNavigateToProxy ? (
              <button
                className="font-medium text-foreground underline underline-offset-4 hover:text-foreground"
                onClick={props.onNavigateToProxy}
                type="button"
              >
                Change in Proxy settings.
              </button>
            ) : (
              <span>Change in Proxy settings.</span>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {subscriptionOAuthProviders.map((provider) => {
            const record = providerKeys.find((item) => item.provider === provider);
            const connected = isOAuthConnected(record?.value);
            const expanded = expandedProvider === provider;
            const importValue = importValues[provider] ?? "";
            const importError = importErrors[provider];
            const importing = isImporting[provider] ?? false;
            const command = getCliLoginCommand(provider);

            return (
              <div className="space-y-2" key={provider}>
                <Item className="items-start" variant="outline">
                  <ItemContent>
                    <ItemTitle className="text-sm font-medium text-foreground">
                      {getOAuthProviderName(provider)}
                    </ItemTitle>
                    <ItemDescription>
                      {connected
                        ? "Connected"
                        : "Run a terminal login command, then paste the returned code here."}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions className="ml-auto shrink-0">
                    {connected ? (
                      <Button
                        onClick={async () => {
                          try {
                            await disconnectProvider(provider);
                            toast.success(`${getOAuthProviderName(provider)} disconnected`);
                          } catch {
                            toast.error("Could not disconnect");
                          }
                        }}
                        size="sm"
                        variant="outline"
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        onClick={() => {
                          setExpandedProvider(expanded ? undefined : provider);
                          setImportErrors((current) => ({
                            ...current,
                            [provider]: undefined,
                          }));
                        }}
                        size="sm"
                        variant={expanded ? "outline" : "secondary"}
                      >
                        {expanded ? "Hide" : "Connect with CLI"}
                      </Button>
                    )}
                  </ItemActions>
                </Item>

                {!connected && expanded ? (
                  <Item className="items-start" variant="muted">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="text-sm font-medium text-foreground">
                        Connect with login code
                      </ItemTitle>
                      <ItemDescription>
                        1. Run the command below in your terminal. 2. Complete sign-in in your
                        browser. 3. Paste the returned code here.
                      </ItemDescription>
                      <div className="mt-3 space-y-3">
                        <div className="space-y-2">
                          <div className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                            Run this command
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <code className="min-w-0 flex-1 overflow-x-auto border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
                              {command}
                            </code>
                            <Button
                              className="shrink-0"
                              onClick={async () => {
                                if (await copyText(command)) {
                                  toast.success("Command copied");
                                  return;
                                }
                                toast.error("Could not copy command");
                              }}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Copy command
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <div className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
                            Paste the returned code
                          </div>
                          <Textarea
                            autoComplete="off"
                            className="min-h-24"
                            onChange={(event) => {
                              const value = event.target.value;
                              setImportValues((current) => ({
                                ...current,
                                [provider]: value,
                              }));
                              if (importErrors[provider]) {
                                setImportErrors((current) => ({
                                  ...current,
                                  [provider]: undefined,
                                }));
                              }
                            }}
                            placeholder={`Paste the code from ${command}`}
                            value={importValue}
                          />
                          {importError ? (
                            <div className="text-xs text-destructive">{importError}</div>
                          ) : null}
                          <div className="flex justify-end">
                            <Button
                              disabled={importing || importValue.trim().length === 0}
                              onClick={async () => {
                                setIsImporting((current) => ({
                                  ...current,
                                  [provider]: true,
                                }));
                                setImportErrors((current) => ({
                                  ...current,
                                  [provider]: undefined,
                                }));

                                try {
                                  await importOAuthCredentialsForProvider(provider, importValue);
                                  setImportValues((current) => ({
                                    ...current,
                                    [provider]: "",
                                  }));
                                  setExpandedProvider(undefined);
                                  toast.success(`Connected to ${getOAuthProviderName(provider)}`);
                                } catch (error) {
                                  setImportErrors((current) => ({
                                    ...current,
                                    [provider]:
                                      error instanceof Error
                                        ? error.message
                                        : "Could not import login code",
                                  }));
                                } finally {
                                  setIsImporting((current) => ({
                                    ...current,
                                    [provider]: false,
                                  }));
                                }
                              }}
                              size="sm"
                              variant="secondary"
                            >
                              {importing ? "Connecting..." : "Connect"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </ItemContent>
                  </Item>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-6">
        <div className="space-y-2">
          <h3 className="text-sm font-medium">API Keys</h3>
          <p className="text-xs text-muted-foreground">
            Enter API keys for cloud providers. Keys are stored locally in your browser.
          </p>
        </div>

        <div className="flex flex-col gap-6">
          {apiKeyProviders.map((provider) => {
            const keySaved = hasStoredPlainApiKey(providerKeys, provider);

            return (
              <div className="space-y-2" key={provider}>
                <div className="text-sm font-medium text-foreground">
                  {apiKeyProviderLabel(provider)}
                </div>
                <div className="flex gap-2">
                  <Input
                    autoComplete="off"
                    className="min-w-0 flex-1"
                    onChange={(event) =>
                      setDraftValues((current) => ({
                        ...current,
                        [provider]: event.target.value,
                      }))
                    }
                    placeholder="Enter API key"
                    type="password"
                    value={draftValues[provider] ?? ""}
                  />
                  {keySaved ? (
                    <Button
                      className="shrink-0"
                      onClick={async () => {
                        try {
                          await disconnectProvider(provider);
                          toast.success(`${apiKeyProviderLabel(provider)} API key removed`);
                        } catch {
                          toast.error("Could not remove API key");
                        }
                      }}
                      size="sm"
                      variant="outline"
                    >
                      Clear
                    </Button>
                  ) : (
                    <Button
                      className="shrink-0"
                      onClick={async () => {
                        const value = draftValues[provider]?.trim();

                        if (!value) {
                          toast.warning("Enter an API key first");
                          return;
                        }

                        try {
                          await setProviderApiKey(provider, value);
                          toast.success(`${apiKeyProviderLabel(provider)} API key saved`);
                        } catch {
                          toast.error("Could not save API key");
                        }
                      }}
                      size="sm"
                      variant="secondary"
                    >
                      Save
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
