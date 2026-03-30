import { GitHubFsError } from "@/repo/github-fs"
import type { SystemMessage } from "@/types/chat"
import {
  BusyRuntimeError,
  MissingSessionRuntimeError,
  StreamInterruptedRuntimeError,
} from "@/agent/runtime-command-errors"

export type RuntimeErrorKind =
  | "missing_session"
  | "provider_api"
  | "github_rate_limit"
  | "github_auth"
  | "github_not_found"
  | "github_permission"
  | "github_api"
  | "runtime_busy"
  | "provider_rate_limit"
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
  detailsContext?: string
  detailsHtml?: string
}

const RATE_LIMIT_SUBSTR = "github api rate limit exceeded"
const PROVIDER_MARKERS = [
  "anthropic",
  "openai",
  "openai-codex",
  "fireworks",
  "api.fireworks.ai",
  "gemini",
  "google",
  "groq",
  "mistral",
  "x.ai",
  "proxy",
] as const

function isProviderRateLimitMessage(lower: string): boolean {
  if (lower.includes("github")) {
    return false
  }

  return (
    lower.includes("too many requests") ||
    lower.includes(" 429") ||
    lower.startsWith("429") ||
    (lower.includes("rate limit") &&
      !lower.includes("github api rate limit exceeded"))
  )
}

function normalizeMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

interface HtmlErrorDetail {
  context?: string
  html: string
  summary: string
}

function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)

  if (!match) {
    return undefined
  }

  const normalized = match[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return normalized || undefined
}

function extractHtmlErrorDetail(message: string): HtmlErrorDetail | undefined {
  const match = message.match(/(<!doctype html[\s\S]*<\/html>|<html[\s\S]*<\/html>)/i)

  if (!match || match.index === undefined) {
    return undefined
  }

  const html = match[1].trim()
  const prefix = message
    .slice(0, match.index)
    .replace(/\s+/g, " ")
    .trim()
  const suffix = message
    .slice(match.index + match[1].length)
    .replace(/\s+/g, " ")
    .trim()
  const title = extractHtmlTitle(html)
  const summaryPrefix = prefix || "HTML response"
  const summary = title
    ? `${summaryPrefix} — ${title}`
    : `${summaryPrefix} — HTML response`

  return {
    context: suffix || undefined,
    html,
    summary,
  }
}

function isProviderMessage(lower: string, message: string): boolean {
  if (lower.includes("github")) {
    return false
  }

  if (message.includes(" → https://") || message.includes(" → http://")) {
    return true
  }

  return PROVIDER_MARKERS.some((marker) => lower.includes(marker))
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
  const rawMessage = normalizeMessage(error)
  const htmlDetail = extractHtmlErrorDetail(rawMessage)
  const message = htmlDetail?.summary ?? rawMessage
  const lower = message.toLowerCase()
  const rawLower = rawMessage.toLowerCase()

  if (error instanceof StreamInterruptedRuntimeError) {
    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("stream_interrupted", message),
      kind: "stream_interrupted",
      message,
      severity: "error",
      source: "runtime",
    }
  }

  if (error instanceof BusyRuntimeError) {
    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("runtime_busy", message),
      kind: "runtime_busy",
      message,
      severity: "warning",
      source: "runtime",
    }
  }

  if (error instanceof MissingSessionRuntimeError) {
    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
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
        detailsContext: htmlDetail?.context,
        detailsHtml: htmlDetail?.html,
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
        detailsContext: htmlDetail?.context,
        detailsHtml: htmlDetail?.html,
        fingerprint: fingerprintFor("github_auth", message, path),
        kind: "github_auth",
        message,
        severity: "error",
        source: "github",
      }
    }

    if (error.code === "ENOENT") {
      return {
        detailsContext: htmlDetail?.context,
        detailsHtml: htmlDetail?.html,
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
        detailsContext: htmlDetail?.context,
        detailsHtml: htmlDetail?.html,
        fingerprint: fingerprintFor("github_permission", message, path),
        kind: "github_permission",
        message,
        severity: "error",
        source: "github",
      }
    }

    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("github_api", message, path),
      kind: "github_api",
      message,
      severity: "error",
      source: "github",
    }
  }

  if (
    rawLower.includes("connection error") ||
    rawLower.includes("failed to fetch") ||
    rawLower.includes("networkerror") ||
    rawLower.includes("load failed") ||
    rawLower.includes("the network connection was lost")
  ) {
    const isProvider =
      rawLower.includes("provider") ||
      rawLower.includes("api.openai") ||
      rawLower.includes("anthropic") ||
      rawLower.includes("google") ||
      rawLower.includes("proxy")

    if (isProvider || rawMessage.includes("Connection error.")) {
      return {
        detailsContext: htmlDetail?.context,
        detailsHtml: htmlDetail?.html,
        fingerprint: fingerprintFor("provider_connection", message),
        kind: "provider_connection",
        message,
        severity: "error",
        source: "provider",
      }
    }

    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("repo_network", message),
      kind: "repo_network",
      message,
      severity: "error",
      source: "github",
    }
  }

  if (isProviderRateLimitMessage(rawLower)) {
    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("provider_rate_limit", message),
      kind: "provider_rate_limit",
      message,
      severity: "error",
      source: "provider",
    }
  }

  if (isProviderMessage(rawLower, rawMessage)) {
    return {
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("provider_api", message),
      kind: "provider_api",
      message,
      severity: "error",
      source: "provider",
    }
  }

  if (lower.includes(RATE_LIMIT_SUBSTR) || lower.includes("rate limit")) {
    return {
      action: "open-github-settings",
      detailsContext: htmlDetail?.context,
      detailsHtml: htmlDetail?.html,
      fingerprint: fingerprintFor("github_rate_limit", message),
      kind: "github_rate_limit",
      message,
      severity: "error",
      source: "github",
    }
  }

  return {
    detailsContext: htmlDetail?.context,
    detailsHtml: htmlDetail?.html,
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
    detailsContext: classified.detailsContext,
    detailsHtml: classified.detailsHtml,
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

export function shouldStopStreamingForRuntimeError(error: unknown): boolean {
  const classified = classifyRuntimeError(error)

  return (
    classified.source === "github" &&
    classified.severity === "error" &&
    classified.action === "open-github-settings"
  )
}

type SnapshotWithError = {
  error: string | undefined
}

export function withTerminalError<T extends SnapshotWithError>(
  snapshot: T,
  terminalErrorMessage?: string
): T {
  if (terminalErrorMessage === undefined || snapshot.error !== undefined) {
    return snapshot
  }

  return {
    ...snapshot,
    error: terminalErrorMessage,
  }
}
