"use client"

import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { getFoldedToolResultIds } from "./chat-adapter"
import { ChatComposer } from "./chat-composer"
import { ChatMessage as ChatMessageBlock } from "./chat-message"
import { CHAT_SUGGESTIONS } from "./chat-suggestions"
import type { CSSProperties } from "react"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { ChatMessage } from "@/types/chat"
import type { RepoSource, SessionData } from "@/types/storage"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion"
import { getRuntimeCommandErrorMessage } from "@/agent/runtime-command-errors"
import { runtimeClient } from "@/agent/runtime-client"
import { touchRepository } from "@/db/schema"
import { useRuntimeSession } from "@/hooks/use-runtime-session"
import { getIsoNow } from "@/lib/dates"
import { getCanonicalProvider, getDefaultProviderGroup } from "@/models/catalog"
import {
  createSessionForChat,
  createSessionForRepo,
  persistLastUsedSessionSettings,
  resolveProviderDefaults,
  sessionDestination,
} from "@/sessions/session-actions"
import {
  loadSessionWithMessages,
  persistSessionSnapshot,
} from "@/sessions/session-service"

type EmptyChatDraft = {
  model: string
  providerGroup: ProviderGroupId
  thinkingLevel: ThinkingLevel
}

type LoadedSessionState =
  | { kind: "active"; messages: Array<ChatMessage>; session: SessionData }
  | { kind: "missing" }
  | { kind: "none" }

export interface ChatProps {
  repoSource?: RepoSource
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
      {label}
    </div>
  )
}

function isSameRepoSource(
  left: RepoSource | undefined,
  right: RepoSource | undefined
) {
  if (!left || !right) {
    return left === right
  }

  return (
    left.owner === right.owner &&
    left.repo === right.repo &&
    left.ref === right.ref
  )
}

function repoDestination(repoSource: RepoSource) {
  if (repoSource.ref === "main") {
    return {
      params: {
        owner: repoSource.owner,
        repo: repoSource.repo,
      },
      to: "/$owner/$repo" as const,
    }
  }

  return {
    params: {
      _splat: repoSource.ref,
      owner: repoSource.owner,
      repo: repoSource.repo,
    },
    to: "/$owner/$repo/$" as const,
  }
}

async function persistDetachedSendError(
  sessionId: string,
  error: Error | undefined
) {
  const loaded = await loadSessionWithMessages(sessionId)

  if (!loaded || loaded.session.error || loaded.messages.length > 0) {
    return
  }

  await persistSessionSnapshot({
    ...loaded.session,
    error: getRuntimeCommandErrorMessage(error),
    isStreaming: false,
    updatedAt: getIsoNow(),
  })
}

export function Chat(props: ChatProps) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const sessionId =
    typeof search.session === "string" ? search.session : undefined
  const initialQuery =
    typeof search.initialQuery === "string" && search.initialQuery.trim().length > 0
      ? search.initialQuery
      : undefined
  const loadedSessionState = useLiveQuery(async (): Promise<LoadedSessionState> => {
    if (!sessionId) {
      return { kind: "none" }
    }

    const loaded = await loadSessionWithMessages(sessionId)

    if (!loaded) {
      return { kind: "missing" }
    }

    return {
      kind: "active",
      messages: loaded.messages,
      session: loaded.session,
    }
  }, [sessionId])
  const defaults = useLiveQuery(async () => {
    const resolved = await resolveProviderDefaults()

    return {
      model: resolved.model,
      providerGroup: resolved.providerGroup,
      thinkingLevel: "medium" as ThinkingLevel,
    } satisfies EmptyChatDraft
  }, [])
  const [draft, setDraft] = React.useState<EmptyChatDraft | undefined>(undefined)
  const [draftError, setDraftError] = React.useState<string | undefined>(undefined)
  const [isStartingSession, setIsStartingSession] = React.useState(false)
  const runtime = useRuntimeSession(sessionId)
  const promptRef = React.useRef<HTMLDivElement | null>(null)
  const [promptHeight, setPromptHeight] = React.useState(0)

  React.useEffect(() => {
    if (!props.repoSource) {
      return
    }

    void touchRepository(props.repoSource)
  }, [props.repoSource])

  React.useEffect(() => {
    if (!defaults) {
      return
    }

    setDraft((currentDraft) => currentDraft ?? defaults)
  }, [defaults])

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

  const activeSession =
    loadedSessionState?.kind === "active" ? loadedSessionState.session : undefined
  const messages =
    loadedSessionState?.kind === "active" ? loadedSessionState.messages : []
  const foldedToolResultIds = React.useMemo(
    () => getFoldedToolResultIds(messages),
    [messages]
  )
  const lastAssistantMessageId = React.useMemo(
    () =>
      [...messages].reverse().find((message) => message.role === "assistant")?.id,
    [messages]
  )

  React.useEffect(() => {
    if (loadedSessionState?.kind !== "missing") {
      return
    }

    void navigate({
      ...(props.repoSource ? repoDestination(props.repoSource) : { to: "/chat" as const }),
      replace: true,
      search: (prev) => ({
        initialQuery,
        session: undefined,
        settings: prev.settings,
        sidebar: prev.sidebar,
      }),
    })
  }, [initialQuery, loadedSessionState, navigate, props.repoSource])

  React.useEffect(() => {
    if (
      !props.repoSource ||
      !activeSession ||
      isSameRepoSource(activeSession.repoSource, props.repoSource)
    ) {
      return
    }

    void navigate({
      ...sessionDestination({
        id: activeSession.id,
        repoSource: activeSession.repoSource,
      }),
      replace: true,
      search: (prev) => ({
        initialQuery: undefined,
        session: activeSession.id,
        settings: prev.settings,
        sidebar: prev.sidebar,
      }),
    })
  }, [activeSession, navigate, props.repoSource])

  const persistDraft = React.useCallback((nextDraft: EmptyChatDraft) => {
    setDraft(nextDraft)
    setDraftError(undefined)
    void persistLastUsedSessionSettings({
      model: nextDraft.model,
      provider: getCanonicalProvider(nextDraft.providerGroup),
      providerGroup: nextDraft.providerGroup,
    })
  }, [])

  const handleFirstSend = React.useCallback(
    async (content: string) => {
      if (!draft || isStartingSession) {
        return
      }

      setDraftError(undefined)
      setIsStartingSession(true)

      try {
        const base = {
          model: draft.model,
          provider: getCanonicalProvider(draft.providerGroup),
          providerGroup: draft.providerGroup,
          thinkingLevel: draft.thinkingLevel,
        }
        const session = props.repoSource
          ? await createSessionForRepo({
              base,
              owner: props.repoSource.owner,
              ref: props.repoSource.ref,
              repo: props.repoSource.repo,
            })
          : await createSessionForChat(base)

        await persistLastUsedSessionSettings(session)

        await navigate({
          ...sessionDestination({
            id: session.id,
            repoSource: session.repoSource,
          }),
          search: (prev) => ({
            initialQuery: undefined,
            session: session.id,
            settings: prev.settings,
            sidebar: prev.sidebar,
          }),
        })

        void runtimeClient.send(session.id, content).catch(async (error) => {
          await persistDetachedSendError(
            session.id,
            error instanceof Error ? error : undefined
          )
        })
      } catch (error) {
        setDraftError(
          getRuntimeCommandErrorMessage(
            error instanceof Error ? error : undefined
          )
        )
      } finally {
        setIsStartingSession(false)
      }
    },
    [draft, isStartingSession, navigate, props.repoSource]
  )

  const handleSend = React.useCallback(
    async (content: string) => {
      if (activeSession) {
        await runtime.send(content)
        return
      }

      await handleFirstSend(content)
    },
    [activeSession, handleFirstSend, runtime]
  )

  if (loadedSessionState === undefined) {
    return <LoadingState label="Loading session..." />
  }

  if (loadedSessionState.kind === "missing") {
    return <LoadingState label="Loading session..." />
  }

  if (
    props.repoSource &&
    activeSession &&
    !isSameRepoSource(activeSession.repoSource, props.repoSource)
  ) {
    return <LoadingState label="Loading session..." />
  }

  if (!activeSession && !draft) {
    return <LoadingState label="Loading composer..." />
  }

  const currentModel = activeSession?.model ?? draft?.model ?? ""
  const currentProviderGroup =
    activeSession?.providerGroup ??
    (activeSession ? getDefaultProviderGroup(activeSession.provider) : undefined) ??
    draft?.providerGroup ??
    "opencode-free"
  const currentThinkingLevel =
    activeSession?.thinkingLevel ?? draft?.thinkingLevel ?? "medium"
  const isStreaming = activeSession?.isStreaming ?? isStartingSession
  const currentError = activeSession
    ? runtime.error ?? activeSession.error
    : draftError

  return (
    <div
      className="relative flex size-full min-h-0 flex-col overflow-hidden"
      style={{ "--chat-input-height": `${promptHeight}px` } as CSSProperties}
    >
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="mx-auto w-full max-w-4xl px-4 py-6">
          {messages.map((message, index) => {
            if (
              message.role === "toolResult" &&
              foldedToolResultIds.has(message.id)
            ) {
              return null
            }

            return (
              <ChatMessageBlock
                followingMessages={messages.slice(index + 1)}
                isStreamingReasoning={
                  activeSession?.isStreaming === true &&
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
              {messages.length === 0 ? (
                <Suggestions>
                  {CHAT_SUGGESTIONS.map((suggestion) => (
                    <Suggestion
                      key={suggestion}
                      onClick={() => void handleSend(suggestion)}
                      suggestion={suggestion}
                    />
                  ))}
                </Suggestions>
              ) : null}

              <ChatComposer
                error={currentError}
                initialInput={messages.length === 0 ? initialQuery : undefined}
                isStreaming={isStreaming}
                model={currentModel}
                onAbort={activeSession ? runtime.abort : () => {}}
                onSelectModel={(providerGroup, model) => {
                  if (activeSession) {
                    return runtime.setModelSelection(providerGroup, model)
                  }

                  persistDraft({
                    model,
                    providerGroup,
                    thinkingLevel: currentThinkingLevel,
                  })
                }}
                onSend={handleSend}
                onThinkingLevelChange={(thinkingLevel) => {
                  if (activeSession) {
                    return runtime.setThinkingLevel(thinkingLevel)
                  }

                  persistDraft({
                    model: currentModel,
                    providerGroup: currentProviderGroup,
                    thinkingLevel,
                  })
                }}
                providerGroup={currentProviderGroup}
                thinkingLevel={currentThinkingLevel}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
