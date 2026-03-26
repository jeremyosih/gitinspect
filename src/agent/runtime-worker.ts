import { SessionRuntimeRegistry } from "@/agent/session-runtime-registry"

const registry = new SessionRuntimeRegistry()

export const ensureSession = registry.ensureSession.bind(registry)
export const refreshGithubToken = registry.refreshGithubToken.bind(registry)
export const send = registry.send.bind(registry)
export const abort = registry.abort.bind(registry)
export const releaseSession = async (
  sessionId: string
): Promise<void> => {
  registry.releaseSession(sessionId)
}
export const setModelSelection = registry.setModelSelection.bind(registry)
export const setRepoSource = registry.setRepoSource.bind(registry)
export const setThinkingLevel = registry.setThinkingLevel.bind(registry)
