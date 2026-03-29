const BUSY_RUNTIME_ERROR_NAME = "BusyRuntimeError"
const MISSING_SESSION_RUNTIME_ERROR_NAME = "MissingSessionRuntimeError"
const STREAM_INTERRUPTED_RUNTIME_ERROR_NAME = "StreamInterruptedRuntimeError"

export abstract class RuntimeCommandError extends Error {
  abstract readonly code: "busy" | "missing-session"
  readonly sessionId: string

  protected constructor(name: string, message: string, sessionId: string) {
    super(message)
    this.name = name
    this.sessionId = sessionId
  }
}

export class MissingSessionRuntimeError extends RuntimeCommandError {
  readonly code = "missing-session" as const

  constructor(sessionId: string) {
    super(
      MISSING_SESSION_RUNTIME_ERROR_NAME,
      `Missing runtime session: ${sessionId}`,
      sessionId
    )
  }
}

export class BusyRuntimeError extends RuntimeCommandError {
  readonly code = "busy" as const

  constructor(sessionId: string) {
    super(
      BUSY_RUNTIME_ERROR_NAME,
      `Runtime session is busy: ${sessionId}`,
      sessionId
    )
  }
}

export class StreamInterruptedRuntimeError extends Error {
  constructor(message = "Stream interrupted. The runtime stopped before completion.") {
    super(message)
    this.name = STREAM_INTERRUPTED_RUNTIME_ERROR_NAME
  }
}

export function reviveRuntimeCommandError(
  error: Error,
  sessionId?: string
): Error {
  if (error instanceof RuntimeCommandError) {
    return error
  }

  if (error.name === BUSY_RUNTIME_ERROR_NAME) {
    return new BusyRuntimeError(sessionId ?? "unknown-session")
  }

  if (error.name === MISSING_SESSION_RUNTIME_ERROR_NAME) {
    return new MissingSessionRuntimeError(sessionId ?? "unknown-session")
  }

  return error
}

export function getRuntimeCommandErrorMessage(
  error: Error | undefined
): string {
  if (!error) {
    return "Runtime request failed"
  }

  const normalized = reviveRuntimeCommandError(error)

  if (normalized instanceof BusyRuntimeError) {
    return "This session is already streaming."
  }

  if (normalized instanceof MissingSessionRuntimeError) {
    return "This session could not be loaded from local storage."
  }

  const lower = normalized.message.toLowerCase()

  if (
    lower.includes("too many requests") ||
    lower.startsWith("429") ||
    lower.includes(" 429")
  ) {
    return "The selected provider is rate limited right now. Wait a bit or switch to another model."
  }

  return normalized.message
}
