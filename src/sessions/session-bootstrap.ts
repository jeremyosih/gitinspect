import { BootstrapFailedRuntimeError } from "@/agent/runtime-command-errors"
import { runtimeClient } from "@/agent/runtime-client"
import { getCanonicalProvider } from "@/models/catalog"
import { resolveRepoSource } from "@/repo/settings"
import { appendSessionNotice } from "@/sessions/session-notices"
import {
  createSessionForChat,
  createSessionForRepo,
  type SessionCreationBase,
} from "@/sessions/session-actions"
import { persistSessionSnapshot } from "@/sessions/session-service"
import type { RepoTarget, SessionData } from "@/types/storage"

/**
 * First-send lifecycle (Dexie is source of truth; worker is command executor):
 * 1. Create session row (`createSessionFor*`).
 * 2. `bootstrapStatus: "bootstrap"` until `persistPromptStart` writes user+assistant rows → `ready`.
 * 3. On failure before/during first send, `failed` + system notice (see `appendSessionNotice`).
 */
function toBootstrapFailure(error: unknown): BootstrapFailedRuntimeError {
  return new BootstrapFailedRuntimeError(
    error instanceof Error ? error.message : "Bootstrap failed"
  )
}

async function recordBootstrapFailure(
  sessionId: string,
  error: unknown
): Promise<void> {
  await appendSessionNotice(sessionId, toBootstrapFailure(error), {
    bootstrapStatus: "failed",
    clearStreaming: true,
    rewriteStreamingAssistant: true,
  })
}

export async function bootstrapSessionAndSend(params: {
  content: string
  draft: SessionCreationBase
  repoTarget?: RepoTarget
}): Promise<SessionData> {
  const base = {
    model: params.draft.model,
    provider: getCanonicalProvider(
      params.draft.providerGroup ?? params.draft.provider
    ),
    providerGroup: params.draft.providerGroup ?? params.draft.provider,
    thinkingLevel: params.draft.thinkingLevel,
  }

  let session: SessionData

  try {
    const repoSource = params.repoTarget
      ? await resolveRepoSource(params.repoTarget)
      : undefined

    session = repoSource
      ? await createSessionForRepo({
          base,
          owner: repoSource.owner,
          ref: repoSource.ref,
          repo: repoSource.repo,
        })
      : await createSessionForChat(base)
  } catch (error) {
    session = await createSessionForChat(base)
    await persistSessionSnapshot({
      ...session,
      bootstrapStatus: "bootstrap",
    })
    await recordBootstrapFailure(session.id, error)
    return {
      ...session,
      bootstrapStatus: "failed",
    }
  }

  await persistSessionSnapshot({
    ...session,
    bootstrapStatus: "bootstrap",
  })

  void runtimeClient.send(session.id, params.content).catch(async (error) => {
    try {
      await recordBootstrapFailure(session.id, error)
    } catch (noticeError) {
      console.error("[gitinspect:first-send] bootstrap_notice_failed", {
        error,
        noticeError,
        sessionId: session.id,
      })
    }
  })

  return {
    ...session,
    bootstrapStatus: "bootstrap",
  }
}
