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

function collectToolResultsForAssistant(
  message: AssistantMessage,
  followingMessages: readonly ChatMessage[]
): Map<string, ToolResultMessage> {
  const toolCalls = getAssistantToolCalls(message)
  const toolCallIds = new Set(toolCalls.map((toolCall) => toolCall.id))
  const toolResults = new Map<string, ToolResultMessage>()

  if (toolCallIds.size === 0) {
    return toolResults
  }

  for (const nextMessage of followingMessages) {
    if (nextMessage.role === "assistant") {
      break
    }

    if (
      nextMessage.role === "toolResult" &&
      toolCallIds.has(nextMessage.toolCallId) &&
      !toolResults.has(nextMessage.toolCallId)
    ) {
      toolResults.set(nextMessage.toolCallId, nextMessage)
    }
  }

  return toolResults
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
  toolExecutions: ReadonlyArray<{
    toolCall: ToolCall
    toolResult?: ToolResultMessage
  }>
  versions: readonly string[]
}

export function deriveAssistantView(
  message: AssistantMessage,
  followingMessages: readonly ChatMessage[] = []
): DerivedAssistantView {
  const text = getAssistantText(message)
  const toolCalls = getAssistantToolCalls(message)
  const toolResults = collectToolResultsForAssistant(message, followingMessages)

  return {
    reasoning: getAssistantThinking(message),
    sources: [],
    text,
    toolExecutions: toolCalls.map((toolCall) => ({
      toolCall,
      toolResult: toolResults.get(toolCall.id),
    })),
    versions: [text] as const,
  }
}

export function getFoldedToolResultIds(
  messages: readonly ChatMessage[]
): ReadonlySet<string> {
  const foldedIds = new Set<string>()

  messages.forEach((message, index) => {
    if (message.role !== "assistant") {
      return
    }

    const toolResults = collectToolResultsForAssistant(
      message,
      messages.slice(index + 1)
    )

    for (const toolResult of toolResults.values()) {
      foldedIds.add(toolResult.id)
    }
  })

  return foldedIds
}
