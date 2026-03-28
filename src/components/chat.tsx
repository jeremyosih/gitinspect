"use client"

import * as React from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"
import { getFoldedToolResultIds } from "./chat-adapter"
import { ChatComposer } from "./chat-composer"
import { ChatEmptyState } from "./chat-empty-state"
import { ChatMessage as ChatMessageBlock } from "./chat-message"
import { RepoCombobox } from "./repo-combobox"
import type { RepoComboboxHandle } from "./repo-combobox"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { ChatMessage } from "@/types/chat"
import type { RepoSource, RepoTarget, SessionData } from "@/types/storage"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { StatusShimmer } from "@/components/ai-elements/shimmer"
import { ProgressiveBlur } from "@/components/ui/progressive-blur"
import { Icons } from "@/components/icons"
import { copySessionToClipboard } from "@/lib/copy-session-markdown"
import { touchRepository } from "@/db/schema"
import { useRuntimeSession } from "@/hooks/use-runtime-session"
import { getCanonicalProvider, getDefaultProviderGroup } from "@/models/catalog"
import { normalizeRepoSource, resolveRepoSource } from "@/repo/settings"
import {
  persistLastUsedSessionSettings,
  resolveProviderDefaults,
  sessionDestination,
} from "@/sessions/session-actions"
import { getChatBootstrapPanelMode } from "@/sessions/chat-bootstrap-ui"
import { bootstrapSessionAndSend } from "@/sessions/session-bootstrap"
import { loadSessionWithMessages } from "@/sessions/session-service"

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
  repoSource?: RepoTarget
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
  const [isStartingSession, setIsStartingSession] = React.useState(false)
  const [resolvedRepoSource, setResolvedRepoSource] = React.useState<
    RepoSource | undefined
  >(() => normalizeRepoSource(props.repoSource))
  const [repoResolutionFailed, setRepoResolutionFailed] = React.useState(false)
  const runtime = useRuntimeSession(sessionId)
  const observerRef = React.useRef<ResizeObserver | null>(null)
  const repoComboboxRef = React.useRef<RepoComboboxHandle>(null)
  const [promptHeight, setPromptHeight] = React.useState(0)

  const promptRef = React.useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }

    if (!node || typeof ResizeObserver === "undefined") {
      return
    }

    const updateHeight = () => {
      setPromptHeight(node.offsetHeight)
    }

    updateHeight()

    observerRef.current = new ResizeObserver(updateHeight)
    observerRef.current.observe(node)
  }, [])

  React.useEffect(() => {
    let cancelled = false

    if (!props.repoSource) {
      setResolvedRepoSource(undefined)
      setRepoResolutionFailed(false)
      return
    }

    const normalized = normalizeRepoSource(props.repoSource)
    if (normalized) {
      setResolvedRepoSource(normalized)
      setRepoResolutionFailed(false)
      return
    }

    setResolvedRepoSource(undefined)
    setRepoResolutionFailed(false)

    void resolveRepoSource(props.repoSource)
      .then((nextRepoSource) => {
        if (!cancelled) {
          setResolvedRepoSource(nextRepoSource)
          setRepoResolutionFailed(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedRepoSource(undefined)
          setRepoResolutionFailed(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    props.repoSource?.owner,
    props.repoSource?.ref,
    props.repoSource?.repo,
    props.repoSource?.token,
  ])

  React.useEffect(() => {
    if (!resolvedRepoSource) {
      return
    }

    void touchRepository(resolvedRepoSource)
  }, [resolvedRepoSource])

  React.useEffect(() => {
    if (!defaults) {
      return
    }

    setDraft((currentDraft) => currentDraft ?? defaults)
  }, [defaults])

  const activeSession =
    loadedSessionState?.kind === "active" ? loadedSessionState.session : undefined
  const messages =
    loadedSessionState?.kind === "active" ? loadedSessionState.messages : []
  const hasAssistantMessage = React.useMemo(
    () => messages.some((message) => message.role === "assistant"),
    [messages]
  )
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

    if (props.repoSource && !resolvedRepoSource) {
      return
    }

    void navigate({
      ...(resolvedRepoSource
        ? repoDestination(resolvedRepoSource)
        : { to: "/chat" as const }),
      replace: true,
      search: (prev) => ({
        initialQuery,
        session: undefined,
        settings: prev.settings,
        sidebar: prev.sidebar,
      }),
    })
  }, [initialQuery, loadedSessionState, navigate, props.repoSource, resolvedRepoSource])

  React.useEffect(() => {
    if (
      !resolvedRepoSource ||
      !activeSession ||
      isSameRepoSource(activeSession.repoSource, resolvedRepoSource)
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
  }, [activeSession, navigate, resolvedRepoSource])

  const persistDraft = React.useCallback((nextDraft: EmptyChatDraft) => {
    setDraft(nextDraft)
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

      setIsStartingSession(true)

      try {
        const session = await bootstrapSessionAndSend({
          content,
          draft: {
            model: draft.model,
            provider: getCanonicalProvider(draft.providerGroup),
            providerGroup: draft.providerGroup,
            thinkingLevel: draft.thinkingLevel,
          },
          repoTarget: props.repoSource,
        })

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
    !resolvedRepoSource &&
    !repoResolutionFailed
  ) {
    return <LoadingState label="Loading repository..." />
  }

  if (
    resolvedRepoSource &&
    activeSession &&
    !isSameRepoSource(activeSession.repoSource, resolvedRepoSource)
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
  const chatPanelMode = getChatBootstrapPanelMode({
    bootstrapStatus: activeSession?.bootstrapStatus,
    effectiveStreaming: isStreaming,
    hasAssistantMessage,
    messageCount: messages.length,
  })

  return (
    <div
      className="relative flex size-full min-h-0 flex-col overflow-hidden"
      style={{ "--chat-input-height": `${promptHeight}px` } as React.CSSProperties}
    >
      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          className={`mx-auto w-full max-w-4xl px-4 py-6 ${
            messages.length === 0 ? "min-h-full" : ""
          }`}
        >
          {chatPanelMode === "bootstrap_spinner" ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <StatusShimmer>Starting session...</StatusShimmer>
            </div>
          ) : chatPanelMode === "streaming_pending" ? (
            <div className="mb-4 flex justify-start">
              <StatusShimmer>Assistant is streaming...</StatusShimmer>
            </div>
          ) : chatPanelMode === "empty_ready" ? (
            <ChatEmptyState
              onSuggestionClick={(text) => void handleSend(text)}
              onSwitchRepo={() => repoComboboxRef.current?.focusAndClear()}
              repoSource={resolvedRepoSource}
            />
          ) : chatPanelMode === "empty_other" ? null : (
            messages.map((message, index) => {
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
            })
          )}
        </ConversationContent>
        <ConversationScrollButton className="z-[15]" />
        {messages.length > 0 ? (
          <>
            <ProgressiveBlur className="z-[5]" height="32px" position="top" />
            <ProgressiveBlur
              className="z-[5]"
              position="bottom"
              style={{ bottom: "var(--chat-input-height, 0px)" }}
            />
          </>
        ) : null}
      </Conversation>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <div className="mx-auto w-full max-w-4xl px-4">
          <div className="pointer-events-auto flex items-center justify-between pb-2">
            <RepoCombobox
              ref={repoComboboxRef}
              autoFocus={!sessionId && !resolvedRepoSource}
              repoSource={resolvedRepoSource}
            />
            {messages.length > 0 ? (
              <button
                className="flex items-center gap-1.5 rounded-sm border border-border/50 bg-muted px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => {
                  copySessionToClipboard(messages).then(
                    () => toast.success("Copied session as Markdown"),
                    () => toast.error("Failed to copy to clipboard")
                  )
                }}
                type="button"
              >
                <Icons.copy className="size-3.5" />
                <span>Copy as Markdown</span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="pointer-events-auto bg-background">
          <div className="mx-auto w-full max-w-4xl px-4 pb-4">
            <div ref={promptRef}>
              <ChatComposer
                composerDisabled={!resolvedRepoSource}
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
