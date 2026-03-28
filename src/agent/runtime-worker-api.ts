import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import { AgentHost } from "@/agent/agent-host"
import { BusyRuntimeError } from "@/agent/runtime-command-errors"
import { logRuntimeDebug } from "@/lib/runtime-debug"
import { getGithubPersonalAccessToken } from "@/repo/github-token"
import { loadSessionWithMessages } from "@/sessions/session-service"
import { reconcileInterruptedSession } from "@/sessions/session-notices"

let host: AgentHost | undefined
let activeSessionId: string | undefined

export async function init(id: string): Promise<boolean> {
  if (host && activeSessionId === id) {
    return true
  }

  if (host) {
    host.dispose()
    host = undefined
  }

  activeSessionId = id
  const loaded = await loadSessionWithMessages(id)

  if (!loaded) {
    activeSessionId = undefined
    return false
  }

  // A fresh worker seeing isStreaming=true means the previous runtime died mid-turn.
  if (loaded.session.isStreaming) {
    await reconcileInterruptedSession(id)
  }

  const reloaded = loaded.session.isStreaming
    ? await loadSessionWithMessages(id)
    : loaded

  if (!reloaded) {
    activeSessionId = undefined
    return false
  }

  const githubRuntimeToken = await getGithubPersonalAccessToken()
  host = new AgentHost(reloaded.session, reloaded.messages, {
    getGithubToken: getGithubPersonalAccessToken,
    githubRuntimeToken,
  })

  return true
}

function requireHost(options: { idle?: boolean } = {}): AgentHost {
  if (!host || !activeSessionId) {
    throw new Error("Worker not initialized")
  }

  if (options.idle && host.isBusy()) {
    throw new BusyRuntimeError(activeSessionId)
  }

  return host
}

export async function send(content: string): Promise<void> {
  logRuntimeDebug("prompt_started", {
    contentLength: content.trim().length,
    sessionId: activeSessionId,
  })
  await requireHost({ idle: true }).prompt(content)
}

export function abort(): Promise<void> {
  host?.abort()
  return Promise.resolve()
}

export function dispose(): Promise<void> {
  host?.dispose()
  host = undefined
  activeSessionId = undefined
  return Promise.resolve()
}

export async function setModelSelection(
  providerGroup: ProviderGroupId,
  modelId: string
): Promise<void> {
  await requireHost({ idle: true }).setModelSelection(providerGroup, modelId)
}

export async function refreshGithubToken(): Promise<void> {
  await requireHost({ idle: true }).refreshGithubToken()
}

export async function setThinkingLevel(
  thinkingLevel: ThinkingLevel
): Promise<void> {
  await requireHost({ idle: true }).setThinkingLevel(thinkingLevel)
}
