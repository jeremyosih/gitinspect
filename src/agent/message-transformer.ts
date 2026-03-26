import type { AgentMessage } from "@mariozechner/pi-agent-core"
import type { Message } from "@mariozechner/pi-ai"
import type {
  AssistantMessage,
  ToolResultMessage,
} from "@/types/chat"
import type { JsonValue } from "@/types/common"

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

function getMessageText(message: Message): string {
  if (message.role === "assistant") {
    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
  }

  if (message.role === "user") {
    if (typeof message.content === "string") {
      return message.content
    }

    return message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function hasToolCalls(message: Message): message is AssistantMessage {
  return (
    message.role === "assistant" &&
    message.content.some((part) => part.type === "toolCall")
  )
}

function getToolCallIds(message: AssistantMessage): Set<string> {
  const ids = new Set<string>()

  for (const block of message.content) {
    if (block.type === "toolCall") {
      ids.add(block.id)
    }
  }

  return ids
}

function isToolResultFor(
  message: Message,
  toolCallIds: Set<string>
): message is ToolResultMessage {
  return message.role === "toolResult" && toolCallIds.has(message.toolCallId)
}

function reorderMessages(messages: Message[]): Message[] {
  const result: Message[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]

    if (message && hasToolCalls(message)) {
      result.push(message)
      index += 1

      const toolCallIds = getToolCallIds(message)
      const toolResults: Message[] = []
      const otherMessages: Message[] = []

      while (index < messages.length && messages[index]?.role !== "assistant") {
        const next = messages[index]

        if (next && isToolResultFor(next, toolCallIds)) {
          toolResults.push(next)
        } else if (next) {
          otherMessages.push(next)
        }

        index += 1
      }

      result.push(...toolResults, ...otherMessages)
      continue
    }

    if (message) {
      result.push(message)
    }
    index += 1
  }

  return result
}

export function webMessageTransformer(messages: AgentMessage[]): Message[] {
  return reorderMessages(messages.filter(isLlmMessage))
}

export function toOpenAIResponsesInput(messages: Message[]) {
  return messages.flatMap((message) => {
    if (message.role === "assistant") {
      const items: Array<Record<string, JsonValue>> = []
      const text = getMessageText(message)

      if (text.length > 0) {
        items.push({
          content: text,
          role: "assistant",
          type: "message",
        })
      }

      for (const block of message.content) {
        if (block.type !== "toolCall") {
          continue
        }

        const [callId, responseItemId] = block.id.split("|")
        items.push({
          arguments: JSON.stringify(block.arguments),
          call_id: callId,
          id: responseItemId,
          name: block.name,
          type: "function_call",
        })
      }

      return items
    }

    if (message.role === "toolResult") {
      const [callId] = message.toolCallId.split("|")
      return [
        {
          call_id: callId,
          output: getMessageText(message) || "(no output)",
          type: "function_call_output",
        },
      ]
    }

    return [
      {
        content: getMessageText(message),
        role: message.role,
        type: "message",
      },
    ]
  })
}
