import { normalizeSessionRuntime } from "@gitinspect/db/session-runtime";
import { linkToolResults } from "@gitinspect/pi/agent/tool-result-linker";
import { loadSessionWithMessages } from "@gitinspect/pi/sessions/session-service";
import type { MessageRow, SessionData, SessionRuntimeRow } from "@gitinspect/db/storage-types";
import type {
  AssistantMessage,
  DisplayAssistantMessage,
  DisplayChatMessage,
} from "@gitinspect/pi/types/chat";

export interface SessionViewModel {
  displayMessages: DisplayChatMessage[];
  hasPartialAssistantText: boolean;
  isStreaming: boolean;
  runtime?: SessionRuntimeRow;
  session: SessionData;
  transcriptMessages: MessageRow[];
}

function hasAssistantDraftContent(message: AssistantMessage | undefined): boolean {
  if (!message) {
    return false;
  }

  return message.content.some((block) => {
    switch (block.type) {
      case "text":
        return block.text.trim().length > 0;
      case "thinking":
        return block.thinking.trim().length > 0;
      case "toolCall":
        return true;
    }
  });
}

function projectRuntimeMessage(
  runtime: SessionRuntimeRow | undefined,
): DisplayAssistantMessage | undefined {
  if (!runtime?.streamMessage || (runtime.phase !== "interrupted" && runtime.phase !== "running")) {
    return undefined;
  }

  return {
    ...runtime.streamMessage,
    status: runtime.phase === "interrupted" ? "interrupted" : "streaming",
  };
}

export async function loadSessionViewModel(
  sessionId: string,
): Promise<SessionViewModel | undefined> {
  const loaded = await loadSessionWithMessages(sessionId);

  if (!loaded) {
    return undefined;
  }

  const linkedTranscript = linkToolResults(loaded.messages).messages;
  const normalizedRuntime = normalizeSessionRuntime(sessionId, loaded.runtime);
  const runtimeMessage = projectRuntimeMessage(normalizedRuntime);
  const displayMessages = runtimeMessage
    ? ([...linkedTranscript, runtimeMessage] satisfies DisplayChatMessage[])
    : (linkedTranscript satisfies DisplayChatMessage[]);

  return {
    displayMessages,
    hasPartialAssistantText: hasAssistantDraftContent(normalizedRuntime?.streamMessage),
    isStreaming: normalizedRuntime?.phase === "running",
    runtime: normalizedRuntime,
    session: loaded.session,
    transcriptMessages: linkedTranscript,
  };
}
