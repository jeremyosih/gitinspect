import type { ProviderGroupId, ProviderId } from "@/types/models"
import type { RepoSource, SessionData } from "@/types/storage"
import { deleteSession,
  getSetting,
  listProviderKeys,
  setSetting } from "@/db/schema"
import { runtimeClient } from "@/agent/runtime-client"
import {
  getCanonicalProvider,
  getConnectedProviders,
  getDefaultModelForGroup,
  getDefaultProviderGroup,
  getPreferredProviderGroup,
  getProviderGroups,
  getVisibleProviderGroups,
  hasModelForGroup,
  isProviderGroupId,
} from "@/models/catalog"
import {
  createSession,
  persistSessionSnapshot,
} from "@/sessions/session-service"

function isProviderId(value: string): value is ProviderId {
  return (
    getProviderGroups().includes(value as ProviderGroupId) &&
    value !== "opencode-free"
  )
}

function normalizeVisibleSession(
  session: SessionData,
  visibleProviderGroups: Array<ProviderGroupId>
): SessionData {
  const fallbackProviderGroup = visibleProviderGroups[0] ?? "opencode-free"
  const currentProviderGroup = session.providerGroup ?? session.provider
  const providerGroup = visibleProviderGroups.includes(currentProviderGroup)
    ? currentProviderGroup
    : fallbackProviderGroup
  const model = hasModelForGroup(providerGroup, session.model)
    ? session.model
    : getDefaultModelForGroup(providerGroup).id

  if (providerGroup === currentProviderGroup && model === session.model) {
    return session
  }

  return {
    ...session,
    model,
    provider: getCanonicalProvider(providerGroup),
    providerGroup,
  }
}

export async function persistVisibleSessionSelection(
  session: SessionData,
  visibleProviderGroups: Array<ProviderGroupId>
): Promise<SessionData> {
  const normalized = normalizeVisibleSession(session, visibleProviderGroups)

  if (
    normalized.providerGroup !== session.providerGroup ||
    normalized.provider !== session.provider ||
    normalized.model !== session.model
  ) {
    await persistSessionSnapshot(normalized)
  }

  return normalized
}

export async function resolveProviderDefaults(): Promise<{
  model: string
  providerGroup: ProviderGroupId
  visibleProviderGroups: Array<ProviderGroupId>
}> {
  const providerKeys = await listProviderKeys()
  const connectedProviders = getConnectedProviders(providerKeys)
  const visibleProviderGroups = getVisibleProviderGroups(connectedProviders)
  const fallbackProviderGroup = getPreferredProviderGroup(connectedProviders)
  const storedProviderGroup = await getSetting("last-used-provider-group")
  const storedProvider = await getSetting("last-used-provider")
  const providerGroup =
    typeof storedProviderGroup === "string" &&
    isProviderGroupId(storedProviderGroup) &&
    visibleProviderGroups.includes(storedProviderGroup)
      ? storedProviderGroup
      : typeof storedProvider === "string" && isProviderId(storedProvider)
        ? (() => {
            const nextProviderGroup = getDefaultProviderGroup(storedProvider)
            return visibleProviderGroups.includes(nextProviderGroup)
              ? nextProviderGroup
              : fallbackProviderGroup
          })()
        : fallbackProviderGroup
  const storedModel = await getSetting("last-used-model")
  const model =
    typeof storedModel === "string" && hasModelForGroup(providerGroup, storedModel)
      ? storedModel
      : getDefaultModelForGroup(providerGroup).id

  return { model, providerGroup, visibleProviderGroups }
}

export async function persistLastUsedSessionSettings(
  session: Pick<SessionData, "model" | "provider" | "providerGroup">
): Promise<void> {
  await Promise.all([
    setSetting("last-used-model", session.model),
    setSetting("last-used-provider", session.provider),
    setSetting(
      "last-used-provider-group",
      session.providerGroup ?? session.provider
    ),
  ])
}

export type SessionCreationBase = Pick<
  SessionData,
  "model" | "provider" | "providerGroup" | "thinkingLevel"
>

export type SessionRouteTarget = Pick<SessionData, "id" | "repoSource">

export function sessionDestination(
  target: SessionRouteTarget
):
  | {
      to: "/chat"
    }
  | {
      params: {
        _splat: string
        owner: string
        repo: string
      }
      to: "/$owner/$repo/$"
    } {
  if (target.repoSource) {
    return {
      params: {
        _splat: target.repoSource.ref,
        owner: target.repoSource.owner,
        repo: target.repoSource.repo,
      },
      to: "/$owner/$repo/$",
    }
  }

  return {
    to: "/chat",
  }
}

export async function createSessionForChat(
  base?: SessionCreationBase
): Promise<SessionData> {
  if (!base) {
    const { model, providerGroup, visibleProviderGroups } =
      await resolveProviderDefaults()
    const session = createSession({
      model,
      providerGroup,
      repoSource: undefined,
    })
    await persistSessionSnapshot(session)
    return await persistVisibleSessionSelection(session, visibleProviderGroups)
  }

  const session = createSession({
    model: base.model,
    providerGroup: base.providerGroup ?? base.provider,
    thinkingLevel: base.thinkingLevel,
  })
  await persistSessionSnapshot(session)
  return session
}

export async function createSessionForRepo(params: {
  base?: SessionCreationBase
  owner: string
  ref: string
  repo: string
}): Promise<SessionData> {
  const repoSource: RepoSource = {
    owner: params.owner,
    ref: params.ref,
    repo: params.repo,
  }

  if (!params.base) {
    const { model, providerGroup, visibleProviderGroups } =
      await resolveProviderDefaults()
    const session = createSession({
      model,
      providerGroup,
      repoSource,
    })
    await persistSessionSnapshot(session)
    return await persistVisibleSessionSelection(session, visibleProviderGroups)
  }

  const session = createSession({
    model: params.base.model,
    providerGroup: params.base.providerGroup ?? params.base.provider,
    repoSource,
    thinkingLevel: params.base.thinkingLevel,
  })
  await persistSessionSnapshot(session)
  return session
}

export async function createSessionAndSend(params: {
  base: SessionCreationBase
  content: string
  repoSource?: RepoSource
}): Promise<SessionData> {
  const session = params.repoSource
    ? await createSessionForRepo({
        base: params.base,
        owner: params.repoSource.owner,
        ref: params.repoSource.ref,
        repo: params.repoSource.repo,
      })
    : await createSessionForChat(params.base)

  await persistLastUsedSessionSettings(session)

  const result = await runtimeClient.send(session.id, params.content)

  if (!result.ok) {
    await deleteSession(session.id)
    throw new Error(result.error ?? "missing-session")
  }

  return session
}

export async function deleteSessionAndResolveNext(params: {
  sessionId: string
  siblingSessions: Array<SessionData>
}): Promise<{ nextSession?: SessionRouteTarget }> {
  try {
    await runtimeClient.releaseSession(params.sessionId)
  } catch {
    // Ignore runtime release failures during local session deletion.
  }

  await deleteSession(params.sessionId)

  const fallback = params.siblingSessions.find(
    (session) => session.id !== params.sessionId
  )

  if (fallback) {
    return {
      nextSession: {
        id: fallback.id,
        repoSource: fallback.repoSource,
      },
    }
  }

  return { nextSession: undefined }
}
