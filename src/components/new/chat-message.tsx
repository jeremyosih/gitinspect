import {
  Message,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources"
import { ToolCallBubble } from "@/components/tool-call-bubble"
import { ToolResultBubble } from "@/components/tool-result-bubble"
import type { ChatMessage as ChatMessageType } from "@/types/chat"
import {
  deriveAssistantView,
  getUserText,
  isToolResultMessage,
} from "./chat-adapter"

export function ChatMessage(props: {
  isStreamingReasoning: boolean
  message: ChatMessageType
}) {
  const { message } = props

  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent>
          <MessageResponse>{getUserText(message)}</MessageResponse>
        </MessageContent>
      </Message>
    )
  }

  if (isToolResultMessage(message)) {
    return <ToolResultBubble message={message} />
  }

  const view = deriveAssistantView(message)

  return (
    <Message from="assistant">
      <div className="flex w-full flex-col gap-2">
        {view.sources.length > 0 ? (
          <Sources>
            <SourcesTrigger count={view.sources.length} />
            <SourcesContent>
              {view.sources.map((source) => (
                <Source href={source.href} key={source.href} title={source.title}>
                  <span className="font-medium">{source.title}</span>
                </Source>
              ))}
            </SourcesContent>
          </Sources>
        ) : null}

        {view.reasoning ? (
          <Reasoning isStreaming={props.isStreamingReasoning}>
            <ReasoningTrigger />
            <ReasoningContent>{view.reasoning}</ReasoningContent>
          </Reasoning>
        ) : null}

        <MessageBranch>
          <MessageBranchContent>
            {view.versions.map((versionText, index) => (
              <MessageContent key={`${message.id}-v${String(index)}`}>
                <MessageResponse>{versionText}</MessageResponse>
              </MessageContent>
            ))}
          </MessageBranchContent>
          <MessageBranchSelector>
            <MessageBranchPrevious />
            <MessageBranchPage />
            <MessageBranchNext />
          </MessageBranchSelector>
        </MessageBranch>

        {view.toolCalls.map((toolCall) => (
          <ToolCallBubble key={toolCall.id} toolCall={toolCall} />
        ))}
      </div>
    </Message>
  )
}
