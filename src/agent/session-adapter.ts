import type { AgentMessage, AgentState, AgentTool } from "@mariozechner/pi-agent-core"
import type { Message, Model } from "@mariozechner/pi-ai"
import { SYSTEM_PROMPT } from "@/agent/system-prompt"
import type {
  AssistantMessage,
  ChatMessage,
  ToolResultMessage,
  UserMessage,
} from "@/types/chat"
import type { MessageRow, MessageStatus, SessionData } from "@/types/storage"

function isLlmMessage(message: AgentMessage): message is Message {
  return (
    typeof message === "object" &&
    message !== null &&
    "role" in message &&
    (message.role === "assistant" ||
      message.role === "toolResult" ||
      message.role === "user")
  )
}

function getStableMessageId(message: Message, index: number): string {
  if ("id" in message && typeof message.id === "string") {
    return message.id
  }

  switch (message.role) {
    case "assistant":
      return `assistant-${message.timestamp}-${index}`
    case "toolResult":
      return `tool-result-${message.toolCallId}-${index}`
    case "user":
      return `user-${message.timestamp}-${index}`
  }
}

export function normalizeMessage(message: Message, index: number): ChatMessage {
  const id = getStableMessageId(message, index)

  switch (message.role) {
    case "assistant":
      return {
        ...message,
        id,
      } satisfies AssistantMessage
    case "toolResult":
      return {
        ...message,
        id,
      } satisfies ToolResultMessage
    case "user":
      return {
        ...message,
        id,
      } satisfies UserMessage
  }
}

export function normalizeMessages(messages: AgentMessage[]): ChatMessage[] {
  return messages
    .filter(isLlmMessage)
    .map((message, index) => normalizeMessage(message, index))
}

export function inferMessageStatus(message: ChatMessage): MessageStatus {
  if (message.role === "system") {
    return "completed"
  }

  if (message.role !== "assistant") {
    return "completed"
  }

  switch (message.stopReason) {
    case "aborted":
      return "aborted"
    case "error":
      return "error"
    default:
      return "completed"
  }
}

export function toMessageRow(
  sessionId: string,
  message: ChatMessage,
  status = inferMessageStatus(message),
  id = message.id
): MessageRow {
  return {
    ...message,
    id,
    sessionId,
    status,
  }
}

export function toChatMessage(message: MessageRow): ChatMessage {
  const { sessionId: _sessionId, status: _status, ...chatMessage } = message
  return chatMessage as ChatMessage
}

/** Rows the LLM / pi-agent should see (excludes local system notices). */
export function toAgentMessages(messages: MessageRow[]): Message[] {
  return messages
    .filter((row) => row.role !== "system")
    .map((message) => toChatMessage(message) as Message)
}

export function normalizeAssistantDraft(
  message: AgentMessage | null | undefined
): AssistantMessage | undefined {
  if (!message || !isLlmMessage(message) || message.role !== "assistant") {
    return undefined
  }

  return normalizeMessage(message, -1) as AssistantMessage
}

export function buildInitialAgentState(
  session: SessionData,
  messages: MessageRow[],
  model: Model<any>,
  tools: AgentTool[]
): Partial<AgentState> {
  return {
    messages: toAgentMessages(messages),
    model,
    systemPrompt: SYSTEM_PROMPT,
    thinkingLevel: session.thinkingLevel,
    tools,
  }
}
