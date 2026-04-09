import type { Message } from "@mariozechner/pi-ai";
import type { MessageRow } from "@gitinspect/db";
import type { ChatMessage, ToolCall, ToolResultMessage } from "@gitinspect/pi/types/chat";

type LinkableAssistantMessage = Extract<
  Message | ChatMessage | MessageRow,
  { role: "assistant" }
> & {
  id?: string;
};

type LinkableToolResultMessage = Extract<
  Message | ChatMessage | MessageRow,
  { role: "toolResult" }
> & {
  parentAssistantId?: string;
};

type LinkableMessage = Message | ChatMessage | MessageRow;

export interface LinkedToolExecution {
  assistantId: string;
  toolCall: ToolCall;
  toolResult?: ToolResultMessage;
}

function isAssistantMessage(message: LinkableMessage): message is LinkableAssistantMessage {
  return message.role === "assistant";
}

function isToolResultMessage(message: LinkableMessage): message is LinkableToolResultMessage {
  return message.role === "toolResult";
}

function getAssistantId(message: LinkableAssistantMessage, index: number): string {
  return typeof message.id === "string" && message.id.length > 0
    ? message.id
    : `assistant-${String(index)}`;
}

function getAssistantToolCalls(message: LinkableAssistantMessage): ToolCall[] {
  return message.content.filter((block): block is ToolCall => block.type === "toolCall");
}

function rewriteToolResultParent<TMessage extends LinkableToolResultMessage>(
  message: TMessage,
  parentAssistantId: string,
): TMessage {
  if (message.parentAssistantId === parentAssistantId) {
    return message;
  }

  return {
    ...message,
    parentAssistantId,
  };
}

export function linkToolResults<TMessage extends LinkableMessage>(
  messages: readonly TMessage[],
): {
  changed: boolean;
  executionsByAssistantId: ReadonlyMap<string, readonly LinkedToolExecution[]>;
  messages: TMessage[];
} {
  const activeToolOwners = new Map<string, string>();
  const executionsByAssistantIdMutable = new Map<string, LinkedToolExecution[]>();
  const output: TMessage[] = [];
  let changed = false;

  messages.forEach((message, index) => {
    if (isAssistantMessage(message)) {
      const assistantId = getAssistantId(message, index);
      const toolCalls = getAssistantToolCalls(message);

      if (toolCalls.length > 0) {
        executionsByAssistantIdMutable.set(
          assistantId,
          toolCalls.map((toolCall) => ({
            assistantId,
            toolCall,
          })),
        );

        for (const toolCall of toolCalls) {
          activeToolOwners.set(toolCall.id, assistantId);
        }
      }

      output.push(message);
      return;
    }

    if (isToolResultMessage(message)) {
      const assistantId = activeToolOwners.get(message.toolCallId);

      if (!assistantId) {
        changed = true;
        return;
      }

      activeToolOwners.delete(message.toolCallId);
      const linkedMessage = rewriteToolResultParent(message, assistantId);
      const executions = executionsByAssistantIdMutable.get(assistantId);
      const execution = executions?.find((entry) => entry.toolCall.id === message.toolCallId);

      if (
        execution &&
        "id" in linkedMessage &&
        "content" in linkedMessage &&
        "isError" in linkedMessage
      ) {
        execution.toolResult = linkedMessage as ToolResultMessage;
      }

      if (linkedMessage !== message) {
        changed = true;
      }

      output.push(linkedMessage as TMessage);
      return;
    }

    output.push(message);
  });

  return {
    changed,
    executionsByAssistantId: executionsByAssistantIdMutable,
    messages: output,
  };
}
