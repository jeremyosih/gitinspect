import type { MessageRow } from "@/types/storage"
import { buildSystemMessage, classifyRuntimeError } from "@/agent/runtime-errors"
import { toMessageRow } from "@/agent/session-adapter"
import { createId } from "@/lib/ids"

export class RuntimeNoticeService {
  private readonly fingerprints: Array<string> = []

  toSystemRow(sessionId: string, error: unknown): MessageRow | undefined {
    const classified = classifyRuntimeError(error)

    if (!this.remember(classified.fingerprint)) {
      return undefined
    }

    return toMessageRow(
      sessionId,
      buildSystemMessage(classified, createId(), Date.now())
    )
  }

  private remember(fingerprint: string): boolean {
    if (this.fingerprints.includes(fingerprint)) {
      return false
    }

    this.fingerprints.push(fingerprint)

    if (this.fingerprints.length > 20) {
      this.fingerprints.shift()
    }

    return true
  }
}
