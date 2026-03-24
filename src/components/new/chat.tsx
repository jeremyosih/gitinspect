import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { useRuntimeSession } from "@/hooks/use-runtime-session"
import type { ChatMessage } from "@/types/chat"
import type { SessionData } from "@/types/storage"
import { ChatComposer } from "./chat-composer"
import { ChatMessage as ChatMessageBlock } from "./chat-message"
import { CHAT_SUGGESTIONS } from "./chat-suggestions"

export interface ChatProps {
  error?: string
  messages: ChatMessage[]
  runtime: ReturnType<typeof useRuntimeSession>
  session: SessionData
}

export function Chat(props: ChatProps) {
  const lastMessage = props.messages[props.messages.length - 1]

  return (
    <div className="relative flex size-full min-h-0 flex-col divide-y overflow-hidden">
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-4xl px-4 py-6">
          {props.messages.map((message) => (
            <ChatMessageBlock
              isStreamingReasoning={
                props.session.isStreaming &&
                message.role === "assistant" &&
                lastMessage?.id === message.id
              }
              key={message.id}
              message={message}
            />
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="grid shrink-0 gap-4 pt-4">
        {props.messages.length === 0 ? (
          <Suggestions className="px-4">
            {CHAT_SUGGESTIONS.map((suggestion) => (
              <Suggestion
                key={suggestion}
                onClick={() => void props.runtime.send(suggestion)}
                suggestion={suggestion}
              />
            ))}
          </Suggestions>
        ) : null}

        <div className="w-full px-4 pb-4">
          <ChatComposer
            error={props.error}
            isStreaming={props.session.isStreaming}
            model={props.session.model}
            onAbort={props.runtime.abort}
            onSelectModel={props.runtime.setModelSelection}
            onSend={props.runtime.send}
            providerGroup={
              props.session.providerGroup ?? props.session.provider
            }
          />
        </div>
      </div>
    </div>
  )
}
