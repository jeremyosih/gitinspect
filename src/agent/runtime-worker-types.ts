import type { ProviderGroupId, ThinkingLevel } from "@/types/models"

export interface RuntimeWorkerApi {
  abort(sessionId: string): Promise<void>
  ensureSession(sessionId: string): Promise<boolean>
  refreshGithubToken(sessionId: string): Promise<void>
  releaseSession(sessionId: string): Promise<void>
  send(sessionId: string, content: string): Promise<void>
  setModelSelection(
    sessionId: string,
    providerGroup: ProviderGroupId,
    modelId: string
  ): Promise<void>
  setThinkingLevel(
    sessionId: string,
    thinkingLevel: ThinkingLevel
  ): Promise<void>
}
