const BUSY_RUNTIME_ERROR_NAME = "BusyRuntimeError"
const MISSING_SESSION_RUNTIME_ERROR_NAME = "MissingSessionRuntimeError"

function extractSessionId(message: string): string {
  const marker = ": "
  const index = message.lastIndexOf(marker)

  if (index === -1) {
    return "unknown-session"
  }

  return message.slice(index + marker.length)
}

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

export function reviveRuntimeCommandError(error: Error): Error {
  if (error instanceof RuntimeCommandError) {
    return error
  }

  if (error.name === BUSY_RUNTIME_ERROR_NAME) {
    return new BusyRuntimeError(extractSessionId(error.message))
  }

  if (error.name === MISSING_SESSION_RUNTIME_ERROR_NAME) {
    return new MissingSessionRuntimeError(extractSessionId(error.message))
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

  return normalized.message
}
