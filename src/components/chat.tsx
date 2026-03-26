"use client"

import * as React from "react"
import { ChatComposer } from "./chat-composer"
import { ChatMessage as ChatMessageBlock } from "./chat-message"
import { CHAT_SUGGESTIONS } from "./chat-suggestions"
import type { CSSProperties } from "react"
import type { SessionData } from "@/types/storage"
import type { ChatMessage } from "@/types/chat"
import type { useRuntimeSession } from "@/hooks/use-runtime-session"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { getFoldedToolResultIds } from "./chat-adapter"

export interface ChatProps {
  error?: string
  messages: Array<ChatMessage>
  runtime: ReturnType<typeof useRuntimeSession>
  session: SessionData
}

export function Chat(props: ChatProps) {
  const promptRef = React.useRef<HTMLDivElement | null>(null)
  const [promptHeight, setPromptHeight] = React.useState(0)
  const foldedToolResultIds = React.useMemo(
    () => getFoldedToolResultIds(props.messages),
    [props.messages]
  )
  const lastAssistantMessageId = React.useMemo(
    () =>
      [...props.messages].reverse().find((message) => message.role === "assistant")
        ?.id,
    [props.messages]
  )

  React.useEffect(() => {
    const node = promptRef.current
    if (!node || typeof ResizeObserver === "undefined") {
      return
    }

    const updateHeight = () => {
      setPromptHeight(node.offsetHeight)
    }

    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <div
      className="relative flex size-full min-h-0 flex-col overflow-hidden"
      style={{ "--chat-input-height": `${promptHeight}px` } as CSSProperties}
    >
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-4xl px-4 py-6">
          {props.messages.map((message, index) => {
            if (
              message.role === "toolResult" &&
              foldedToolResultIds.has(message.id)
            ) {
              return null
            }

            return (
              <ChatMessageBlock
                followingMessages={props.messages.slice(index + 1)}
                isStreamingReasoning={
                  props.session.isStreaming &&
                  message.role === "assistant" &&
                  lastAssistantMessageId === message.id
                }
                key={message.id}
                message={message}
              />
            )
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="pointer-events-auto bg-background">
          <div className="mx-auto w-full max-w-4xl px-4 pb-4">
            <div ref={promptRef} className="grid gap-4 pt-4">
              {props.messages.length === 0 ? (
                <Suggestions>
                  {CHAT_SUGGESTIONS.map((suggestion) => (
                    <Suggestion
                      key={suggestion}
                      onClick={() => void props.runtime.send(suggestion)}
                      suggestion={suggestion}
                    />
                  ))}
                </Suggestions>
              ) : null}

              <ChatComposer
                error={props.error}
                isStreaming={props.session.isStreaming}
                model={props.session.model}
                onAbort={props.runtime.abort}
                onSelectModel={props.runtime.setModelSelection}
                onSend={props.runtime.send}
                onThinkingLevelChange={props.runtime.setThinkingLevel}
                providerGroup={
                  props.session.providerGroup ?? props.session.provider
                }
                thinkingLevel={props.session.thinkingLevel}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
