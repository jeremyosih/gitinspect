import type {
  AssistantMessage as PiAssistantMessage,
  ImageContent as PiImageContent,
  TextContent as PiTextContent,
  ThinkingContent as PiThinkingContent,
  ToolResultMessage as PiToolResultMessage,
  UserMessage as PiUserMessage,
} from "@mariozechner/pi-ai"
import type { JsonValue } from "@/types/common"
export type { StopReason } from "@mariozechner/pi-ai"

export type TextContent = PiTextContent
export type ImageContent = PiImageContent
export type ThinkingContent = PiThinkingContent

export interface ToolCall {
  arguments: Record<string, JsonValue>
  id: string
  name: string
  type: "toolCall"
}

export type UserContent = ImageContent | TextContent
export type AssistantContent = TextContent | ThinkingContent | ToolCall

export type UserMessage = PiUserMessage & { id: string }

export type AssistantMessage = PiAssistantMessage & { id: string }

export type ToolResultMessage = PiToolResultMessage & {
  id: string
  parentAssistantId: string
}

/** Local-only transcript row: not sent to the LLM (filtered in session-adapter). */
export type SystemNoticeSeverity = "error" | "warning" | "info"

export type SystemNoticeAction = "open-github-settings"

export interface SystemMessage {
  id: string
  role: "system"
  timestamp: number
  /** High-level category for styling and CTAs */
  kind: string
  severity: SystemNoticeSeverity
  source: "github" | "provider" | "runtime"
  message: string
  fingerprint: string
  action?: SystemNoticeAction
  detailsContext?: string
  detailsHtml?: string
}

export type ChatMessage =
  | AssistantMessage
  | SystemMessage
  | ToolResultMessage
  | UserMessage
