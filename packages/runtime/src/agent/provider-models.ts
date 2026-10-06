import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Pi from "effect-pi-durable";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import type {
  Api,
  FetchFunction,
  Model,
  Models,
  ProviderRequestOptions,
  ProviderStreams,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { resolveProviderAuthForProvider } from "../auth/resolve-api-key";
import { getModels, getProviders } from "../models/catalog";
import { getProxyConfig } from "../proxy/settings";
import { buildProxiedUrl } from "../proxy/url";
import type { ModelDefinition, ProviderId } from "../types/models";
import { cloudCodeAssistApi } from "./cloud-code-assist";
import { shouldUseProxyForProvider } from "./provider-proxy";

/** Sends a provider's requests through the user's CORS proxy when its credential needs one. */
function proxyFetch(provider: string, apiKey: string, fetch: FetchFunction): FetchFunction {
  const request = async (...[input, init]: Parameters<FetchFunction>) => {
    const proxy = await getProxyConfig();

    if (!proxy.enabled || !shouldUseProxyForProvider(provider, apiKey)) return fetch(input, init);

    return input instanceof Request
      ? fetch(new Request(buildProxiedUrl(proxy.url, input.url), input), init)
      : fetch(buildProxiedUrl(proxy.url, String(input)), init);
  };

  // SAFETY: Providers only call fetch; some runtimes type extra static helpers onto it.
  return request as FetchFunction;
}

function proxied(streams: ProviderStreams): ProviderStreams {
  const options = <O extends ProviderRequestOptions>(model: Model<Api>, value: O | undefined) => ({
    ...value,
    fetch: proxyFetch(model.provider, value?.apiKey ?? "", value?.fetch ?? globalThis.fetch),
  });

  return {
    stream: (model, context, value) => streams.stream(model, context, options(model, value)),
    streamSimple: (model, context, value) =>
      streams.streamSimple(model, context, options(model, value)),
  };
}

/** Wire protocols by `model.api`. The Google SDK accepts no custom fetch and needs no proxy. */
function providerApis(): Record<string, ProviderStreams> {
  return {
    "anthropic-messages": proxied(anthropicMessagesApi()),
    "google-gemini-cli": proxied(cloudCodeAssistApi()),
    "google-generative-ai": googleGenerativeAIApi(),
    "mistral-conversations": proxied(mistralConversationsApi()),
    "openai-codex-responses": proxied(openAICodexResponsesApi()),
    "openai-completions": proxied(openAICompletionsApi()),
    "openai-responses": proxied(openAIResponsesApi()),
  };
}

/** GitInspect's catalog predates Pi AI's model type and has the same fields. */
function toPiModel(model: ModelDefinition): Model<Api> {
  const { free: _free, ...definition } = model;

  // SAFETY: ModelDefinition is the registry snapshot of Pi AI's chat Model; only `compat` is typed more loosely.
  return definition as Model<Api>;
}

function createCatalogProvider(provider: ProviderId, api: Record<string, ProviderStreams>) {
  return createProvider({
    id: provider,
    // Credentials stay in GitInspect's store, where sign-in and OAuth refresh already live.
    auth: {
      apiKey: {
        name: `${provider} credentials`,
        resolve: async () => {
          const auth = await resolveProviderAuthForProvider(provider);

          return auth ? { auth: { apiKey: auth.apiKey } } : undefined;
        },
      },
    },
    models: getModels(provider).map(toPiModel),
    api,
  });
}

/** Every model GitInspect offers, served by Pi AI with the user's own credentials. */
export function createProviderModels(): Models {
  const models = createModels();
  const api = providerApis();

  for (const provider of getProviders()) models.setProvider(createCatalogProvider(provider, api));

  return models;
}

export const ProviderModels = Layer.effect(Pi.Models, Effect.sync(createProviderModels));
