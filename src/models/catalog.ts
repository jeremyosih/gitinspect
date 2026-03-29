// App-facing catalog helpers layered on the shared pi-ai registry.
import {
  getModel as getRegistryModel,
  getModels as getRegistryModels,
} from "@mariozechner/pi-ai"
import type {
  ModelDefinition,
  ProviderGroupId,
  ProviderId,
  Usage,
} from "@/types/models"
import {
  isOAuthCredentials,
  parseOAuthCredentials,
} from "@/auth/oauth-types"
import {
  FIREWORKS_KIMI_K25_TURBO,
  FIREWORKS_KIMI_K25_TURBO_ID,
} from "@/models/builtin-models"
import {
  getAtlasProviderGroups,
  getCanonicalProvider,
  getDefaultProviderGroup,
  getProviderGroupMetadata,
  getRuntimeSupportedProviders,
  isProviderGroupId,
} from "@/models/provider-registry"

const SUPPORTED_PROVIDERS = getRuntimeSupportedProviders()

/** OpenAI API key + Codex OAuth: model selector only lists these. */
const OPENAI_SELECTOR_MODEL_IDS = [
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
] as const

function isOpenAiSelectorModelId(modelId: string): boolean {
  return (OPENAI_SELECTOR_MODEL_IDS as readonly string[]).includes(modelId)
}

/**
 * pi-ai has no `gpt-5.4-nano` under `openai-codex`; reuse OpenAI weights + Codex API template.
 */
function syntheticOpenAiCodexModel(
  modelId: string
): ModelDefinition | undefined {
  const openaiModel = getRegistryModel(
    "openai",
    modelId as never
  ) as ModelDefinition | undefined
  const template =
    (getRegistryModel(
      "openai-codex",
      "gpt-5.4-mini" as never
    ) as ModelDefinition | undefined) ??
    (getRegistryModel(
      "openai-codex",
      "gpt-5.4" as never
    ) as ModelDefinition | undefined)
  if (!openaiModel || !template) {
    return undefined
  }

  return {
    ...openaiModel,
    api: template.api,
    baseUrl: template.baseUrl,
    name: modelId === "gpt-5.4-nano" ? "GPT-5.4 Nano" : openaiModel.name,
    provider: "openai-codex",
  } as ModelDefinition
}

function openAiCodexSelectorModels(
  codexRegistryModels: Array<ModelDefinition>
): Array<ModelDefinition> {
  const byId = new Map(codexRegistryModels.map((model) => [model.id, model]))
  return OPENAI_SELECTOR_MODEL_IDS.map((id) => {
    return byId.get(id) ?? syntheticOpenAiCodexModel(id)
  }).filter((model): model is ModelDefinition => model !== undefined)
}

/** Preferred default model ids when registry still exposes them; otherwise first model is used. */
export const DEFAULT_MODELS: Partial<Record<ProviderId, string>> = {
  anthropic: "claude-sonnet-4-6",
  "fireworks-ai": FIREWORKS_KIMI_K25_TURBO_ID,
  "github-copilot": "gpt-4o",
  "google-gemini-cli": "gemini-2.5-pro",
  openai: "gpt-5.4",
  opencode: "gpt-5.1-codex-mini",
  "opencode-go": "glm-5",
  "openai-codex": "gpt-5.4",
}

const DEFAULT_GROUP_MODELS: Partial<Record<ProviderGroupId, string>> = {
  "fireworks-free": FIREWORKS_KIMI_K25_TURBO_ID,
}

/** Dexie may still hold removed `opencode-free`; map before any group lookup. */
function normalizeLegacyProviderGroupId(group: string): ProviderGroupId {
  if (group === "opencode-free") {
    return "fireworks-free"
  }
  return group as ProviderGroupId
}

export function getProviders(): Array<ProviderId> {
  return SUPPORTED_PROVIDERS
}

function pickOpenAiSelectorModels(
  models: Array<ModelDefinition>
): Array<ModelDefinition> {
  const byId = new Map(models.map((model) => [model.id, model]))
  return OPENAI_SELECTOR_MODEL_IDS.map((id) => byId.get(id)).filter(
    (model): model is ModelDefinition => model !== undefined
  )
}

export function getPiAiModels(provider: ProviderId): ModelDefinition[] {
  if (provider === "fireworks-ai") {
    return [FIREWORKS_KIMI_K25_TURBO]
  }
  const registryModels = getRegistryModels(
    provider as never
  ) as ModelDefinition[]
  if (provider === "openai") {
    return pickOpenAiSelectorModels(registryModels)
  }
  if (provider === "openai-codex") {
    return openAiCodexSelectorModels(registryModels)
  }
  return registryModels
}

export function getPiAiModel(
  provider: ProviderId,
  modelId: string
): ModelDefinition | undefined {
  if (provider === "fireworks-ai") {
    return modelId === FIREWORKS_KIMI_K25_TURBO.id
      ? FIREWORKS_KIMI_K25_TURBO
      : undefined
  }
  const direct = getRegistryModel(
    provider as never,
    modelId as never
  ) as ModelDefinition | undefined
  if (direct) {
    return direct
  }
  if (provider === "openai-codex" && isOpenAiSelectorModelId(modelId)) {
    return syntheticOpenAiCodexModel(modelId)
  }
  return undefined
}

export function getProviderGroups(): Array<ProviderGroupId> {
  return getAtlasProviderGroups().filter((providerGroup) => {
    const provider = getCanonicalProvider(providerGroup)
    return SUPPORTED_PROVIDERS.includes(provider)
  })
}

export function hasStoredProviderCredential(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

function isOpenAiCodexOAuthConnected(value: string): boolean {
  if (!isOAuthCredentials(value)) {
    return false
  }

  try {
    const credentials = parseOAuthCredentials(value)
    return (
      credentials.providerId === "openai-codex" &&
      Boolean(credentials.access?.trim()) &&
      Boolean(credentials.refresh?.trim())
    )
  } catch {
    return false
  }
}

function isProviderRecordConnected(
  record: { provider: ProviderId; value: string }
): boolean {
  if (record.provider === "openai-codex") {
    return isOpenAiCodexOAuthConnected(record.value)
  }

  return hasStoredProviderCredential(record.value)
}

export function getConnectedProviders(
  providerRecords: Array<{ provider: ProviderId; value: string }>
): Array<ProviderId> {
  const connectedProviders = new Set(
    providerRecords
      .filter((record) => isProviderRecordConnected(record))
      .map((record) => record.provider)
  )

  return getProviderGroups()
    .filter((providerGroup) => providerGroup !== "fireworks-free")
    .map((providerGroup) => getCanonicalProvider(providerGroup))
    .filter((provider, index, providers) => {
      return connectedProviders.has(provider) && providers.indexOf(provider) === index
    })
}

export function getVisibleProviderGroups(
  connectedProviders: Array<ProviderId>
): Array<ProviderGroupId> {
  const connectedProviderSet = new Set(connectedProviders)
  const connectedProviderGroups = getProviderGroups().filter((providerGroup) => {
    return (
      providerGroup !== "fireworks-free" &&
      connectedProviderSet.has(getCanonicalProvider(providerGroup))
    )
  })

  return ["fireworks-free", ...connectedProviderGroups]
}

export function getModels(provider: ProviderId): Array<ModelDefinition> {
  return getPiAiModels(provider)
}

export function getModel(provider: ProviderId, modelId: string): ModelDefinition {
  return getPiAiModel(provider, modelId) ?? getDefaultModel(provider)
}

/** Newer / higher-version ids first (display order only). */
function sortModelsForDisplay(models: Array<ModelDefinition>): Array<ModelDefinition> {
  return [...models].sort((left, right) =>
    right.id.localeCompare(left.id, undefined, { numeric: true, sensitivity: "base" })
  )
}

export function getModelsForGroup(
  providerGroup: ProviderGroupId
): Array<ModelDefinition> {
  const group = normalizeLegacyProviderGroupId(providerGroup as string)
  const provider = getCanonicalProvider(group)
  const models = getModels(provider)

  if (provider === "openai" || provider === "openai-codex") {
    return models
  }

  return sortModelsForDisplay(models)
}

export function getDefaultModelForGroup(
  providerGroup: ProviderGroupId
): ModelDefinition {
  const group = normalizeLegacyProviderGroupId(providerGroup as string)
  const preferredModelId = DEFAULT_GROUP_MODELS[group]

  if (preferredModelId) {
    const provider = getCanonicalProvider(group)
    const preferredModel = getPiAiModel(provider, preferredModelId)

    if (preferredModel && hasModelForGroup(group, preferredModel.id)) {
      return preferredModel
    }
  }

  const firstModel = getModelsForGroup(group).at(0)

  if (firstModel === undefined) {
    throw new Error(`Missing default model for provider group: ${group}`)
  }

  return firstModel
}

export function hasModelForGroup(
  providerGroup: ProviderGroupId,
  modelId: string
): boolean {
  const group = normalizeLegacyProviderGroupId(providerGroup as string)
  return getModelsForGroup(group).some((model) => model.id === modelId)
}

export function getModelForGroup(
  providerGroup: ProviderGroupId,
  modelId: string
): ModelDefinition {
  const group = normalizeLegacyProviderGroupId(providerGroup as string)
  return (
    getModelsForGroup(group).find((model) => model.id === modelId) ??
    getDefaultModelForGroup(group)
  )
}

export function getDefaultModel(provider: ProviderId): ModelDefinition {
  const preferredId = DEFAULT_MODELS[provider]
  if (preferredId) {
    const defaultModel = getPiAiModel(provider, preferredId)
    if (defaultModel) {
      return defaultModel
    }
  }

  const first = getPiAiModels(provider).at(0)
  if (!first) {
    throw new Error(`Missing default model for provider: ${provider}`)
  }

  return first
}

export function hasModel(provider: ProviderId, modelId: string): boolean {
  return Boolean(getPiAiModel(provider, modelId))
}

export function getPreferredProviderGroup(
  providersWithAuth: Array<ProviderId>
): ProviderGroupId {
  return getVisibleProviderGroups(providersWithAuth)[0] ?? "fireworks-free"
}

export {
  getCanonicalProvider,
  getDefaultProviderGroup,
  getProviderGroupMetadata,
  isProviderGroupId,
}

export function calculateCost(model: ModelDefinition, usage: Usage): Usage["cost"] {
  const input = (model.cost.input / 1_000_000) * usage.input
  const output = (model.cost.output / 1_000_000) * usage.output
  const cacheRead = (model.cost.cacheRead / 1_000_000) * usage.cacheRead
  const cacheWrite = (model.cost.cacheWrite / 1_000_000) * usage.cacheWrite

  return {
    cacheRead,
    cacheWrite,
    input,
    output,
    total: input + output + cacheRead + cacheWrite,
  }
}
