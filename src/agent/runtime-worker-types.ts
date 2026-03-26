import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { RepoSource } from "@/types/storage"

export type WorkerMode = "shared" | "dedicated"

export type RuntimeCommandError = "busy" | "missing-session"

export interface RuntimeMutationResult {
  error?: RuntimeCommandError
  ok: boolean
}

export interface RuntimeWorkerApi {
  abort(sessionId: string): Promise<void>
  ensureSession(sessionId: string): Promise<boolean>
  refreshGithubToken(sessionId: string): Promise<RuntimeMutationResult>
  releaseSession(sessionId: string): Promise<void>
  send(sessionId: string, content: string): Promise<RuntimeMutationResult>
  setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<RuntimeMutationResult>
  setRepoSource(
    sessionId: string,
    repoSource?: RepoSource
  ): Promise<RuntimeMutationResult>
  setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<RuntimeMutationResult>
}
