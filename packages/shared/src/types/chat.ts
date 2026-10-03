import type { JsonValue } from "./common";
import type { Usage } from "./models";
export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
export interface TextContent {
  type: "text";
  text: string;
  textSignature?: string;
}
export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}
export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
}
export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, JsonValue>;
  thoughtSignature?: string;
}
export type UserContent = ImageContent | TextContent;
export type AssistantContent = TextContent | ThinkingContent | ToolCall;
export interface UserMessage {
  id: string;
  role: "user";
  content: string | UserContent[];
  timestamp: number;
}
export interface AssistantMessage {
  id: string;
  role: "assistant";
  content: AssistantContent[];
  api: string;
  provider: string;
  model: string;
  responseId?: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}
export interface ToolResultMessage {
  id: string;
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: UserContent[];
  details?: unknown;
  isError: boolean;
  parentAssistantId: string;
  timestamp: number;
}

/** Local-only transcript row: not sent to the LLM (filtered in session-adapter). */
export type SystemNoticeSeverity = "error" | "warning" | "info";

export type SystemNoticeAction = "open-github-settings";

export interface SystemMessage {
  id: string;
  role: "system";
  timestamp: number;
  /** High-level category for styling and CTAs */
  kind: string;
  severity: SystemNoticeSeverity;
  source: "github" | "provider" | "runtime";
  message: string;
  fingerprint: string;
  action?: SystemNoticeAction;
  detailsContext?: string;
  detailsHtml?: string;
}

export type ChatMessage = AssistantMessage | SystemMessage | ToolResultMessage | UserMessage;

export type DisplayAssistantStatus = "interrupted" | "streaming";

export type DisplayAssistantMessage = AssistantMessage & {
  status: DisplayAssistantStatus;
};

export type DisplayChatMessage = ChatMessage | DisplayAssistantMessage;
