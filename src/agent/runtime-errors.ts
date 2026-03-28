import { GitHubFsError } from "@/repo/github-fs"
import type { SystemMessage } from "@/types/chat"
import {
  BootstrapFailedRuntimeError,
  BusyRuntimeError,
  MissingSessionRuntimeError,
  StreamInterruptedRuntimeError,
} from "@/agent/runtime-command-errors"

export type RuntimeErrorKind =
  | "bootstrap_failed"
  | "missing_session"
  | "github_rate_limit"
  | "github_auth"
  | "github_not_found"
  | "github_permission"
  | "github_api"
  | "runtime_busy"
  | "repo_network"
  | "provider_connection"
  | "stream_interrupted"
  | "unknown"

export interface ClassifiedRuntimeError {
  kind: RuntimeErrorKind
  fingerprint: string
  message: string
  severity: SystemMessage["severity"]
  source: SystemMessage["source"]
  action?: SystemMessage["action"]
}

const RATE_LIMIT_SUBSTR = "github api rate limit exceeded"

function normalizeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function fingerprintFor(
  kind: RuntimeErrorKind,
  message: string,
  path?: string
): string {
  const base = `${kind}:${message.slice(0, 160)}`
  return path ? `${base}:${path}` : base
}

/**
 * Classify thrown errors from repo tools, provider stream, or agent prompt.
 */
export function classifyRuntimeError(error: unknown): ClassifiedRuntimeError {
  const message = normalizeMessage(error)
  const lower = message.toLowerCase()

  if (error instanceof BootstrapFailedRuntimeError) {
    return {
      fingerprint: fingerprintFor("bootstrap_failed", message),
      kind: "bootstrap_failed",
      message,
      severity: "error",
      source: "runtime",
    }
  }

  if (error instanceof StreamInterruptedRuntimeError) {
    return {
      fingerprint: fingerprintFor("stream_interrupted", message),
      kind: "stream_interrupted",
      message,
      severity: "error",
      source: "runtime",
    }
  }

  if (error instanceof BusyRuntimeError) {
    return {
      fingerprint: fingerprintFor("runtime_busy", message),
      kind: "runtime_busy",
      message,
      severity: "warning",
      source: "runtime",
    }
  }

  if (error instanceof MissingSessionRuntimeError) {
    return {
      fingerprint: fingerprintFor("missing_session", message),
      kind: "missing_session",
      message,
      severity: "error",
      source: "runtime",
    }
  }

  if (error instanceof GitHubFsError) {
    const path = error.path ?? ""

    if (
      error.code === "EACCES" &&
      lower.includes(RATE_LIMIT_SUBSTR)
    ) {
      return {
        action: "open-github-settings",
        fingerprint: fingerprintFor("github_rate_limit", message, path),
        kind: "github_rate_limit",
        message,
        severity: "error",
        source: "github",
      }
    }

    if (
      error.code === "EACCES" &&
      (lower.includes("authentication required") || lower.includes("auth"))
    ) {
      return {
        action: "open-github-settings",
        fingerprint: fingerprintFor("github_auth", message, path),
        kind: "github_auth",
        message,
        severity: "error",
        source: "github",
      }
    }

    if (error.code === "ENOENT") {
      return {
        fingerprint: fingerprintFor("github_not_found", message, path),
        kind: "github_not_found",
        message,
        severity: "warning",
        source: "github",
      }
    }

    if (error.code === "EACCES") {
      return {
        action: "open-github-settings",
        fingerprint: fingerprintFor("github_permission", message, path),
        kind: "github_permission",
        message,
        severity: "error",
        source: "github",
      }
    }

    return {
      fingerprint: fingerprintFor("github_api", message, path),
      kind: "github_api",
      message,
      severity: "error",
      source: "github",
    }
  }

  if (
    lower.includes("connection error") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("the network connection was lost")
  ) {
    const isProvider =
      lower.includes("provider") ||
      lower.includes("api.openai") ||
      lower.includes("anthropic") ||
      lower.includes("google") ||
      lower.includes("proxy")

    if (isProvider || message.includes("Connection error.")) {
      return {
        fingerprint: fingerprintFor("provider_connection", message),
        kind: "provider_connection",
        message,
        severity: "error",
        source: "provider",
      }
    }

    return {
      fingerprint: fingerprintFor("repo_network", message),
      kind: "repo_network",
      message,
      severity: "error",
      source: "github",
    }
  }

  if (lower.includes(RATE_LIMIT_SUBSTR) || lower.includes("rate limit")) {
    return {
      action: "open-github-settings",
      fingerprint: fingerprintFor("github_rate_limit", message),
      kind: "github_rate_limit",
      message,
      severity: "error",
      source: "github",
    }
  }

  return {
    fingerprint: fingerprintFor("unknown", message),
    kind: "unknown",
    message,
    severity: "error",
    source: "runtime",
  }
}

export function buildSystemMessage(
  classified: ClassifiedRuntimeError,
  id: string,
  timestamp: number
): SystemMessage {
  return {
    action: classified.action,
    fingerprint: classified.fingerprint,
    id,
    kind: classified.kind,
    message: classified.message,
    role: "system",
    severity: classified.severity,
    source: classified.source,
    timestamp,
  }
}
