import * as React from "react"
import { getSetting, listProviderKeys, setSetting } from "@/db/schema"
import {
  getDefaultModel,
  getPreferredProvider,
  getProviders,
  hasModel,
} from "@/models/catalog"
import { getLastUsedRepoSource, setLastUsedRepoSource } from "@/repo/settings"
import { createSession, loadMostRecentSession, loadSession } from "@/sessions/session-service"
import type { ProviderId } from "@/types/models"
import type { SessionData } from "@/types/storage"

export interface AppBootstrapState {
  error?: string
  session?: SessionData
  status: "error" | "loading" | "ready"
}

function isProviderId(value: string): value is ProviderId {
  return getProviders().includes(value as ProviderId)
}

export async function loadInitialSession(): Promise<SessionData> {
  const providerKeys = await listProviderKeys()
  const storedProvider = await getSetting("last-used-provider")
  const provider =
    typeof storedProvider === "string" && isProviderId(storedProvider)
      ? storedProvider
      : getPreferredProvider(providerKeys.map((record) => record.provider))
  const storedModel = await getSetting("last-used-model")
  const model =
    typeof storedModel === "string" && hasModel(provider, storedModel)
      ? storedModel
      : getDefaultModel(provider).id
  const requestedSessionId =
    typeof window === "undefined"
      ? undefined
      : new URLSearchParams(window.location.search).get("session")
  const activeSessionId = await getSetting("active-session-id")
  const explicitSessionId =
    requestedSessionId ??
    (typeof activeSessionId === "string" ? activeSessionId : undefined)

  if (explicitSessionId) {
    const loaded = await loadSession(explicitSessionId)

    if (loaded) {
      return loaded
    }
  }

  const recent = await loadMostRecentSession()

  if (recent) {
    return recent
  }

  return createSession({
    model,
    provider,
    repoSource: await getLastUsedRepoSource(),
  })
}

export function useAppBootstrap(): AppBootstrapState {
  const [state, setState] = React.useState<AppBootstrapState>({
    status: "loading",
  })

  React.useEffect(() => {
    let disposed = false

    void (async () => {
      try {
        const session = await loadInitialSession()

        await setSetting("active-session-id", session.id)
        await setSetting("last-used-model", session.model)
        await setSetting("last-used-provider", session.provider)
        await setLastUsedRepoSource(session.repoSource)

        if (!disposed) {
          setState({
            session,
            status: "ready",
          })
        }
      } catch (error) {
        if (!disposed) {
          setState({
            error: error instanceof Error ? error.message : "Bootstrap failed",
            status: "error",
          })
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [])

  return state
}
