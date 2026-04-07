import { linkToolResults } from "@gitinspect/pi/agent/tool-result-linker";
import type {
  AssistantMessage,
  ChatMessage,
  DisplayChatMessage,
  SystemMessage,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@gitinspect/pi/types/chat";

export function getUserText(message: UserMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function getAssistantThinking(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "thinking")
    .map((part) => part.thinking)
    .join("\n");
}

export function getAssistantToolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter((part): part is ToolCall => part.type === "toolCall");
}

function collectToolResultsForAssistant(
  message: AssistantMessage,
  followingMessages: readonly ChatMessage[],
): Map<string, ToolResultMessage> {
  const linkedMessages = linkToolResults([message, ...followingMessages]).messages;
  const toolResults = new Map<string, ToolResultMessage>();

  for (const linkedMessage of linkedMessages) {
    if (linkedMessage.role !== "toolResult") {
      continue;
    }

    if (
      linkedMessage.parentAssistantId === message.id &&
      !toolResults.has(linkedMessage.toolCallId)
    ) {
      toolResults.set(linkedMessage.toolCallId, linkedMessage);
    }
  }

  return toolResults;
}

export function getToolResultText(message: ToolResultMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function isToolResultMessage(message: ChatMessage): message is ToolResultMessage {
  return message.role === "toolResult";
}

export function isSystemMessage(message: ChatMessage): message is SystemMessage {
  return message.role === "system";
}

export interface SourceRef {
  href: string;
  title: string;
}

export interface DerivedAssistantView {
  reasoning: string;
  sources: readonly SourceRef[];
  text: string;
  toolExecutions: ReadonlyArray<{
    toolCall: ToolCall;
    toolResult?: ToolResultMessage;
  }>;
  versions: readonly string[];
}

export function deriveAssistantView(
  message: AssistantMessage,
  followingMessages: readonly DisplayChatMessage[] = [],
): DerivedAssistantView {
  const text = getAssistantText(message);
  const toolCalls = getAssistantToolCalls(message);
  const toolResults = collectToolResultsForAssistant(message, followingMessages);

  return {
    reasoning: getAssistantThinking(message),
    sources: [],
    text,
    toolExecutions: toolCalls.map((toolCall) => ({
      toolCall,
      toolResult: toolResults.get(toolCall.id),
    })),
    versions: [text] as const,
  };
}

export function getFoldedToolResultIds(
  messages: readonly DisplayChatMessage[],
): ReadonlySet<string> {
  const linkedMessages = linkToolResults(messages).messages;
  const foldedIds = new Set<string>();

  for (const message of linkedMessages) {
    if (message.role === "toolResult") {
      foldedIds.add(message.id);
    }
  }

  return foldedIds;
}
