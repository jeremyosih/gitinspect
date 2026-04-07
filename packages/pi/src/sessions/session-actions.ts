import type { ProviderGroupId, ProviderId } from "@gitinspect/pi/types/models";
import type { ResolvedRepoSource, SessionData } from "@gitinspect/db/storage-types";
import { deleteSession, getSetting, listProviderKeys, setSetting } from "@gitinspect/db/schema";
import { runtimeClient } from "@gitinspect/pi/agent/runtime-client";
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
} from "@gitinspect/pi/models/catalog";
import { createSession, persistSessionSnapshot } from "@gitinspect/pi/sessions/session-service";

function isProviderId(value: string): value is ProviderId {
  return getProviderGroups().includes(value as ProviderGroupId);
}

function normalizeVisibleSession(
  session: SessionData,
  visibleProviderGroups: Array<ProviderGroupId>,
): SessionData {
  const fallbackProviderGroup = visibleProviderGroups[0] ?? "fireworks-free";
  const rawGroup = session.providerGroup ?? session.provider;
  const migratedGroup = (rawGroup as string) === "opencode-free" ? "fireworks-free" : rawGroup;
  const currentProviderGroup = migratedGroup as ProviderGroupId;
  const providerGroup = visibleProviderGroups.includes(currentProviderGroup)
    ? currentProviderGroup
    : fallbackProviderGroup;
  const model = hasModelForGroup(providerGroup, session.model)
    ? session.model
    : getDefaultModelForGroup(providerGroup).id;

  if (providerGroup === currentProviderGroup && model === session.model) {
    return session;
  }

  return {
    ...session,
    model,
    provider: getCanonicalProvider(providerGroup),
    providerGroup,
  };
}

export async function persistVisibleSessionSelection(
  session: SessionData,
  visibleProviderGroups: Array<ProviderGroupId>,
): Promise<SessionData> {
  const normalized = normalizeVisibleSession(session, visibleProviderGroups);

  if (
    normalized.providerGroup !== session.providerGroup ||
    normalized.provider !== session.provider ||
    normalized.model !== session.model
  ) {
    await persistSessionSnapshot(normalized);
  }

  return normalized;
}

export async function resolveProviderDefaults(): Promise<{
  model: string;
  providerGroup: ProviderGroupId;
  visibleProviderGroups: Array<ProviderGroupId>;
}> {
  const providerKeys = await listProviderKeys();
  const connectedProviders = getConnectedProviders(providerKeys);
  const visibleProviderGroups = getVisibleProviderGroups(connectedProviders);
  const fallbackProviderGroup = getPreferredProviderGroup(connectedProviders);
  const storedProviderGroupRaw = await getSetting("last-used-provider-group");
  const storedProviderGroup =
    storedProviderGroupRaw === "opencode-free" ? "fireworks-free" : storedProviderGroupRaw;
  const storedProvider = await getSetting("last-used-provider");
  const providerGroup =
    typeof storedProviderGroup === "string" &&
    isProviderGroupId(storedProviderGroup) &&
    visibleProviderGroups.includes(storedProviderGroup)
      ? storedProviderGroup
      : typeof storedProvider === "string" && isProviderId(storedProvider)
        ? (() => {
            const nextProviderGroup = getDefaultProviderGroup(storedProvider);
            return visibleProviderGroups.includes(nextProviderGroup)
              ? nextProviderGroup
              : fallbackProviderGroup;
          })()
        : fallbackProviderGroup;
  const storedModel = await getSetting("last-used-model");
  const model =
    typeof storedModel === "string" && hasModelForGroup(providerGroup, storedModel)
      ? storedModel
      : getDefaultModelForGroup(providerGroup).id;

  return { model, providerGroup, visibleProviderGroups };
}

export async function persistLastUsedSessionSettings(
  session: Pick<SessionData, "model" | "provider" | "providerGroup">,
): Promise<void> {
  await Promise.all([
    setSetting("last-used-model", session.model),
    setSetting("last-used-provider", session.provider),
    setSetting("last-used-provider-group", session.providerGroup ?? session.provider),
  ]);
}

export type SessionCreationBase = Pick<
  SessionData,
  "model" | "provider" | "providerGroup" | "thinkingLevel"
>;

export function buildSessionHref(sessionId: string): string {
  return `/chat/${encodeURIComponent(sessionId)}`;
}

export async function createSessionForChat(base?: SessionCreationBase): Promise<SessionData> {
  if (!base) {
    const { model, providerGroup, visibleProviderGroups } = await resolveProviderDefaults();
    return normalizeVisibleSession(
      createSession({
        model,
        providerGroup,
        repoSource: undefined,
      }),
      visibleProviderGroups,
    );
  }

  return createSession({
    model: base.model,
    providerGroup: base.providerGroup ?? getDefaultProviderGroup(base.provider),
    thinkingLevel: base.thinkingLevel,
  });
}

export async function createSessionForRepo(params: {
  base?: SessionCreationBase;
  repoSource: ResolvedRepoSource;
  sourceUrl?: string;
}): Promise<SessionData> {
  if (!params.base) {
    const { model, providerGroup, visibleProviderGroups } = await resolveProviderDefaults();
    return normalizeVisibleSession(
      createSession({
        model,
        providerGroup,
        repoSource: params.repoSource,
        sourceUrl: params.sourceUrl,
      }),
      visibleProviderGroups,
    );
  }

  return createSession({
    model: params.base.model,
    providerGroup: params.base.providerGroup ?? getDefaultProviderGroup(params.base.provider),
    repoSource: params.repoSource,
    sourceUrl: params.sourceUrl,
    thinkingLevel: params.base.thinkingLevel,
  });
}

export async function deleteSessionAndResolveNext(params: {
  sessionId: string;
  siblingSessions: Array<SessionData>;
}): Promise<{ nextSessionId?: string }> {
  try {
    await runtimeClient.releaseSessionAndDrain(params.sessionId);
  } catch {
    // Ignore runtime release failures during local session deletion.
  }

  await deleteSession(params.sessionId);

  const fallback = params.siblingSessions.find((session) => session.id !== params.sessionId);

  if (fallback) {
    return {
      nextSessionId: fallback.id,
    };
  }

  return { nextSessionId: undefined };
}
