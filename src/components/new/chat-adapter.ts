import type {
  AssistantMessage,
  ChatMessage,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@/types/chat"

export function getUserText(message: UserMessage): string {
  if (typeof message.content === "string") {
    return message.content
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

export function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
}

export function getAssistantThinking(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "thinking")
    .map((part) => part.thinking)
    .join("\n")
}

export function getAssistantToolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter(
    (part): part is ToolCall => part.type === "toolCall"
  )
}

export function getToolResultText(message: ToolResultMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

export function isToolResultMessage(
  message: ChatMessage
): message is ToolResultMessage {
  return message.role === "toolResult"
}

export interface SourceRef {
  href: string
  title: string
}

export interface DerivedAssistantView {
  reasoning: string
  sources: readonly SourceRef[]
  text: string
  toolCalls: ToolCall[]
  versions: readonly string[]
}

export function deriveAssistantView(
  message: AssistantMessage
): DerivedAssistantView {
  const text = getAssistantText(message)

  return {
    reasoning: getAssistantThinking(message),
    sources: [],
    text,
    toolCalls: getAssistantToolCalls(message),
    versions: [text] as const,
  }
}
