import type { BootstrapStatus } from "@/types/storage"

/**
 * Maps persisted session flags + message shape to which main chat panel region to show.
 * Single place for bootstrap UI rules (see `session-bootstrap.ts` + `persistPromptStart`).
 */
export type ChatBootstrapPanelMode =
  | "bootstrap_spinner"
  | "empty_other"
  | "empty_ready"
  | "messages"
  | "streaming_pending"

export function getChatBootstrapPanelMode(input: {
  bootstrapStatus: BootstrapStatus | undefined
  effectiveStreaming: boolean
  hasAssistantMessage: boolean
  messageCount: number
}): ChatBootstrapPanelMode {
  const bootstrapStatus = input.bootstrapStatus ?? "ready"
  const {
    effectiveStreaming,
    hasAssistantMessage,
    messageCount,
  } = input

  if (bootstrapStatus === "bootstrap" && messageCount === 0) {
    return "bootstrap_spinner"
  }

  if (
    (bootstrapStatus === "bootstrap" || effectiveStreaming) &&
    messageCount > 0 &&
    !hasAssistantMessage
  ) {
    return "streaming_pending"
  }

  if (messageCount === 0) {
    return bootstrapStatus === "ready" ? "empty_ready" : "empty_other"
  }

  return "messages"
}
