"use client"

import * as React from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useLiveQuery } from "dexie-react-hooks"
import { event as trackEvent } from "onedollarstats"
import { toast } from "sonner"
import { getAssistantText, getFoldedToolResultIds } from "./chat-adapter"
import { ChatComposer } from "./chat-composer"
import { ChatEmptyState } from "./chat-empty-state"
import { ChatMessage as ChatMessageBlock } from "./chat-message"
import { RepoCombobox } from "./repo-combobox"
import type { RepoComboboxHandle } from "./repo-combobox"
import type { ProviderGroupId, ThinkingLevel } from "@/types/models"
import type { AssistantMessage, ChatMessage } from "@/types/chat"
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
import { getSessionRuntime, touchRepository } from "@/db/schema"
import { runtimeClient } from "@/agent/runtime-client"
import { getRuntimeCommandErrorMessage } from "@/agent/runtime-command-errors"
import { useRuntimeSession } from "@/hooks/use-runtime-session"
import { useSessionOwnership } from "@/hooks/use-session-ownership"
import { getCanonicalProvider, getDefaultProviderGroup } from "@/models/catalog"
import { normalizeRepoSource, resolveRepoSource } from "@/repo/settings"
import {
  handleGithubError,
  showGithubSystemNoticeToast,
} from "@/repo/github-fetch"
import {
  createSessionForChat,
  createSessionForRepo,
  persistLastUsedSessionSettings,
  resolveProviderDefaults,
} from "@/sessions/session-actions"
import { reconcileInterruptedSession } from "@/sessions/session-notices"
import { loadSessionWithMessages } from "@/sessions/session-service"
import {
  deriveActiveSessionViewState,
  deriveBannerState,
  deriveComposerState,
  deriveRecoveryIntent,
  deriveResumeAction,
  shouldDisplayConversationStreaming,
} from "@/sessions/session-view-state"

type EmptyChatDraft = {
  model: string
  providerGroup: ProviderGroupId
  thinkingLevel: ThinkingLevel
}

type LoadedSessionState =
  | { kind: "active"; messages: Array<ChatMessage>; session: SessionData }
  | { kind: "missing" }
  | { kind: "none" }

type ChatPanelMode = "empty" | "messages" | "starting" | "streaming_pending"

export interface ChatProps {
  repoSource?: RepoTarget
  sessionId?: string
}

function isSystemNotice(
  message: ChatMessage
): message is Extract<ChatMessage, { role: "system" }> {
  return message.role === "system"
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
      {label}
    </div>
  )
}

function getChatPanelMode(input: {
  hasAssistantMessage: boolean
  isStartingSession: boolean
  isStreaming: boolean
  messageCount: number
}): ChatPanelMode {
  if (input.isStartingSession && input.messageCount === 0) {
    return "starting"
  }

  if (
    input.isStreaming &&
    input.messageCount > 0 &&
    !input.hasAssistantMessage
  ) {
    return "streaming_pending"
  }

  if (input.messageCount === 0) {
    return "empty"
  }

  return "messages"
}

function formatRelativeProgress(value: string | undefined): string | undefined {
  if (!value) {
    return undefined
  }

  const timestamp = Date.parse(value)

  if (!Number.isFinite(timestamp)) {
    return undefined
  }

  const elapsedMs = Math.max(0, Date.now() - timestamp)
  const elapsedMinutes = Math.floor(elapsedMs / 60_000)

  if (elapsedMinutes < 1) {
    return "just now"
  }

  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60)

  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`
  }

  const elapsedDays = Math.floor(elapsedHours / 24)
  return `${elapsedDays}d ago`
}

function getLastAssistantMessage(
  messages: ReadonlyArray<ChatMessage>
): AssistantMessage | undefined {
  return [...messages]
    .reverse()
    .find(
      (message): message is AssistantMessage => message.role === "assistant"
    )
}

function trackMessageSent(path?: string) {
  void trackEvent("Message sent", path).catch(() => {
    // Analytics must never interfere with chat sends.
  })
}

export function Chat(props: ChatProps) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false })
  const settings =
    typeof search.settings === "string" ? search.settings : undefined
  const sidebar = search.sidebar === "open" ? "open" : undefined
  const q =
    typeof search.q === "string" && search.q.trim().length > 0
      ? search.q
      : undefined
  const loadedSessionState =
    useLiveQuery(async (): Promise<LoadedSessionState> => {
      if (!props.sessionId) {
        return { kind: "none" }
      }

      const loaded = await loadSessionWithMessages(props.sessionId)

      if (!loaded) {
        return { kind: "missing" }
      }

      return {
        kind: "active",
        messages: loaded.messages,
        session: loaded.session,
      }
    }, [props.sessionId])
  const sessionRuntime = useLiveQuery(
    async () =>
      props.sessionId ? await getSessionRuntime(props.sessionId) : undefined,
    [props.sessionId]
  )
  const defaults = useLiveQuery(async () => {
    const resolved = await resolveProviderDefaults()

    return {
      model: resolved.model,
      providerGroup: resolved.providerGroup,
      thinkingLevel: "medium" as ThinkingLevel,
    } satisfies EmptyChatDraft
  }, [])
  const [draft, setDraft] = React.useState<EmptyChatDraft | undefined>(
    undefined
  )
  const [isStartingSession, setIsStartingSession] = React.useState(false)
  const [resolvedRepoSource, setResolvedRepoSource] = React.useState<
    RepoSource | undefined
  >(() => normalizeRepoSource(props.repoSource))
  const [repoResolutionFailed, setRepoResolutionFailed] = React.useState(false)
  const runtime = useRuntimeSession(props.sessionId)
  const ownership = useSessionOwnership(
    loadedSessionState?.kind === "active"
      ? loadedSessionState.session.id
      : undefined
  )
  const observerRef = React.useRef<ResizeObserver | null>(null)
  const repoComboboxRef = React.useRef<RepoComboboxHandle>(null)
  const recoveryInFlightRef = React.useRef(false)
  const surfacedSystemNoticeFingerprintsRef = React.useRef(new Set<string>())
  const surfacedSystemNoticeSessionIdRef = React.useRef<string | undefined>(
    undefined
  )
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
      .catch((error) => {
        void handleGithubError(error, { sessionId: props.sessionId })
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

  const activeSession =
    loadedSessionState?.kind === "active"
      ? loadedSessionState.session
      : undefined
  const displayRepoSource = activeSession?.repoSource ?? resolvedRepoSource

  React.useEffect(() => {
    if (!displayRepoSource) {
      return
    }

    void touchRepository(displayRepoSource)
  }, [displayRepoSource])

  React.useEffect(() => {
    if (!defaults) {
      return
    }

    setDraft((currentDraft) => currentDraft ?? defaults)
  }, [defaults])

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
  const lastAssistantMessage = React.useMemo(
    () => getLastAssistantMessage(messages),
    [messages]
  )
  const lastAssistantMessageId = React.useMemo(
    () => lastAssistantMessage?.id,
    [lastAssistantMessage]
  )
  const hasPartialAssistantText = React.useMemo(
    () =>
      lastAssistantMessage !== undefined &&
      getAssistantText(lastAssistantMessage).trim().length > 0,
    [lastAssistantMessage, sessionRuntime]
  )
  const activeSessionViewState = React.useMemo(
    () =>
      activeSession
        ? deriveActiveSessionViewState({
            hasLocalRunner: runtimeClient.hasActiveTurn(activeSession.id),
            hasPartialAssistantText,
            lastProgressAt: sessionRuntime?.lastProgressAt,
            leaseState: ownership,
            runtimeStatus: sessionRuntime?.status,
            sessionIsStreaming: activeSession.isStreaming,
          })
        : undefined,
    [
      activeSession,
      hasPartialAssistantText,
      ownership,
      sessionRuntime?.lastProgressAt,
      sessionRuntime?.status,
    ]
  )

  React.useEffect(() => {
    if (surfacedSystemNoticeSessionIdRef.current === activeSession?.id) {
      return
    }

    surfacedSystemNoticeSessionIdRef.current = activeSession?.id
    surfacedSystemNoticeFingerprintsRef.current = new Set(
      messages.filter(isSystemNotice).map((message) => message.fingerprint)
    )
  }, [activeSession?.id, messages])

  React.useEffect(() => {
    if (!activeSession?.id) {
      return
    }

    if (surfacedSystemNoticeSessionIdRef.current !== activeSession.id) {
      return
    }

    const seenFingerprints = surfacedSystemNoticeFingerprintsRef.current
    const unseenErrors = messages.filter(
      (message): message is Extract<ChatMessage, { role: "system" }> =>
        isSystemNotice(message) &&
        message.severity === "error" &&
        !seenFingerprints.has(message.fingerprint)
    )

    for (const message of unseenErrors) {
      seenFingerprints.add(message.fingerprint)
      if (showGithubSystemNoticeToast(message)) {
        continue
      }

      toast.error(getRuntimeCommandErrorMessage(new Error(message.message)))
    }
  }, [activeSession?.id, messages])

  const recoveryIntent = React.useMemo(
    () =>
      activeSessionViewState
        ? deriveRecoveryIntent(activeSessionViewState)
        : "none",
    [activeSessionViewState]
  )
  const bannerState = React.useMemo(
    () =>
      activeSessionViewState
        ? deriveBannerState(activeSessionViewState)
        : undefined,
    [activeSessionViewState]
  )
  const resumeAction = React.useMemo(
    () =>
      activeSessionViewState
        ? deriveResumeAction(activeSessionViewState)
        : undefined,
    [activeSessionViewState]
  )
  const activeComposerState = React.useMemo(
    () =>
      activeSessionViewState
        ? deriveComposerState(activeSessionViewState)
        : undefined,
    [activeSessionViewState]
  )
  const lastProgressLabel = React.useMemo(
    () => formatRelativeProgress(sessionRuntime?.lastProgressAt),
    [sessionRuntime?.lastProgressAt]
  )
  const displayConversationStreaming = React.useMemo(
    () =>
      activeSessionViewState
        ? shouldDisplayConversationStreaming(activeSessionViewState)
        : false,
    [activeSessionViewState]
  )

  const maybeRecoverInterruptedSession = React.useEffectEvent(
    async (trigger: "mount" | "visibility") => {
      if (!activeSession || recoveryIntent !== "run-now") {
        return
      }

      if (recoveryInFlightRef.current) {
        return
      }

      recoveryInFlightRef.current = true

      try {
        const outcome = await reconcileInterruptedSession(activeSession.id, {
          hasLocalRunner: runtimeClient.hasActiveTurn(activeSession.id),
        })

        if (outcome.kind === "reconciled") {
          console.info("[gitinspect:runtime] interrupted_session_reconciled", {
            lastProgressAt: outcome.lastProgressAt,
            sessionId: activeSession.id,
            trigger,
          })
        }
      } catch (error) {
        console.error("[gitinspect:runtime] stale_stream_reconcile_failed", {
          error,
          sessionId: activeSession.id,
          trigger,
        })
      } finally {
        recoveryInFlightRef.current = false
      }
    }
  )

  React.useEffect(() => {
    if (!activeSession || recoveryIntent !== "run-now") {
      return
    }

    void maybeRecoverInterruptedSession("mount")
  }, [activeSession?.id, maybeRecoverInterruptedSession, recoveryIntent])

  React.useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return
      }

      if (!activeSession || recoveryIntent !== "run-now") {
        return
      }

      void maybeRecoverInterruptedSession("visibility")
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [activeSession?.id, maybeRecoverInterruptedSession, recoveryIntent])

  React.useEffect(() => {
    if (loadedSessionState?.kind !== "missing") {
      return
    }

    void navigate({
      replace: true,
      search: {
        q: undefined,
        settings,
        sidebar,
      },
      to: "/chat",
    })
  }, [loadedSessionState, navigate, settings, sidebar])

  const persistDraft = React.useCallback((nextDraft: EmptyChatDraft) => {
    setDraft(nextDraft)
    void persistLastUsedSessionSettings({
      model: nextDraft.model,
      provider: getCanonicalProvider(nextDraft.providerGroup),
      providerGroup: nextDraft.providerGroup,
    })
  }, [])

  const reportRuntimeFailure = React.useCallback(
    (error: Error) => {
      toast.error(getRuntimeCommandErrorMessage(error))
      console.error("[gitinspect:runtime] command_failed", {
        message: error.message,
        sessionId: activeSession?.id,
      })
    },
    [activeSession?.id]
  )

  const handleFirstSend = React.useCallback(
    async (content: string) => {
      if (!draft || isStartingSession) {
        return
      }

      setIsStartingSession(true)

      try {
        const base = {
          model: draft.model,
          provider: getCanonicalProvider(draft.providerGroup),
          providerGroup: draft.providerGroup,
          thinkingLevel: draft.thinkingLevel,
        }
        const session = resolvedRepoSource
          ? await createSessionForRepo({
              base,
              owner: resolvedRepoSource.owner,
              ref: resolvedRepoSource.ref,
              repo: resolvedRepoSource.repo,
            })
          : await createSessionForChat(base)
        await runtimeClient.startInitialTurn(session, content)
        trackMessageSent()
        await navigate({
          params: {
            sessionId: session.id,
          },
          search: {
            q: undefined,
            settings,
            sidebar,
          },
          to: "/chat/$sessionId",
        })

        void persistLastUsedSessionSettings(session)
      } catch (error) {
        reportRuntimeFailure(
          error instanceof Error ? error : new Error(String(error))
        )
      } finally {
        setIsStartingSession(false)
      }
    },
    [
      draft,
      isStartingSession,
      navigate,
      reportRuntimeFailure,
      resolvedRepoSource,
      settings,
      sidebar,
    ]
  )

  const handleSend = React.useCallback(
    async (content: string) => {
      if (activeSession) {
        if (!activeComposerState?.canSend) {
          if (activeComposerState?.disabledReason) {
            toast.error(activeComposerState.disabledReason)
          }
          return
        }

        try {
          await runtime.send(content)
          trackMessageSent("/chat")
        } catch (error) {
          reportRuntimeFailure(
            error instanceof Error ? error : new Error(String(error))
          )
        }
        return
      }

      await handleFirstSend(content)
    },
    [
      activeComposerState,
      activeSession,
      handleFirstSend,
      reportRuntimeFailure,
      runtime,
    ]
  )

  const handleResumeInterrupted = React.useCallback(async () => {
    if (!resumeAction) {
      return
    }

    try {
      await runtime.resumeInterrupted(resumeAction.mode)
    } catch (error) {
      reportRuntimeFailure(
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }, [reportRuntimeFailure, resumeAction, runtime])

  if (loadedSessionState === undefined) {
    return <LoadingState label="Loading session..." />
  }

  if (loadedSessionState.kind === "missing") {
    return <LoadingState label="Loading session..." />
  }

  if (props.repoSource && !resolvedRepoSource && !repoResolutionFailed) {
    return <LoadingState label="Loading repository..." />
  }

  if (!activeSession && !draft) {
    return <LoadingState label="Loading composer..." />
  }

  const currentModel = activeSession?.model ?? draft?.model ?? ""
  const currentProviderGroup =
    activeSession?.providerGroup ??
    (activeSession
      ? getDefaultProviderGroup(activeSession.provider)
      : undefined) ??
    draft?.providerGroup ??
    "fireworks-free"
  const currentThinkingLevel =
    activeSession?.thinkingLevel ?? draft?.thinkingLevel ?? "medium"
  const isStreaming =
    activeSession !== undefined
      ? (activeComposerState?.isStreaming ?? false)
      : isStartingSession
  const composerDisabled =
    !displayRepoSource || activeComposerState?.disabled === true
  const composerDisabledReason = !displayRepoSource
    ? "Select a repository to get started"
    : activeComposerState?.disabledReason
  const chatPanelMode = getChatPanelMode({
    hasAssistantMessage,
    isStartingSession,
    isStreaming: displayConversationStreaming || isStartingSession,
    messageCount: messages.length,
  })

  return (
    <div
      className="relative flex size-full min-h-0 flex-col overflow-hidden"
      style={
        { "--chat-input-height": `${promptHeight}px` } as React.CSSProperties
      }
    >
      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          className={`mx-auto w-full max-w-4xl px-4 py-6 ${
            messages.length === 0 ? "min-h-full" : ""
          }`}
        >
          {bannerState?.kind === "remote-live" ? (
            <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              Read-only mirror. This session is active in another tab.
              {lastProgressLabel ? ` Last progress ${lastProgressLabel}.` : ""}
            </div>
          ) : bannerState?.kind === "remote-stale" ? (
            <div className="mb-4 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
              Read-only mirror. Another tab still owns this streaming session.
              {lastProgressLabel ? ` Last progress ${lastProgressLabel}.` : ""}
            </div>
          ) : null}
          {chatPanelMode === "starting" ? (
            <div className="flex min-h-[30vh] items-center justify-center">
              <StatusShimmer>Starting session...</StatusShimmer>
            </div>
          ) : chatPanelMode === "streaming_pending" ? (
            <div className="mb-4 flex justify-start">
              <StatusShimmer>Assistant is streaming...</StatusShimmer>
            </div>
          ) : chatPanelMode === "empty" ? (
            <ChatEmptyState
              onSuggestionClick={(text) => void handleSend(text)}
              onSwitchRepo={() => repoComboboxRef.current?.focusAndClear()}
              repoSource={displayRepoSource}
            />
          ) : (
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
                    displayConversationStreaming &&
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
              autoFocus={!props.sessionId && !displayRepoSource}
              repoSource={displayRepoSource}
              sessionId={props.sessionId}
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
            {bannerState?.kind === "interrupted" &&
            resumeAction &&
            activeSession ? (
              <div className="mb-3 rounded-md border border-border bg-muted px-3 py-3 text-sm text-foreground">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="font-medium">Response interrupted</div>
                    <div className="text-muted-foreground">
                      {bannerState.resumeMode === "continue"
                        ? "A partial assistant response was saved locally."
                        : "The last response stopped before any assistant text was saved."}
                      {lastProgressLabel
                        ? ` Last progress ${lastProgressLabel}.`
                        : ""}
                    </div>
                  </div>
                  <button
                    className="inline-flex items-center justify-center rounded-sm border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                    onClick={() => {
                      void handleResumeInterrupted()
                    }}
                    type="button"
                  >
                    {resumeAction.label}
                  </button>
                </div>
              </div>
            ) : null}
            <div ref={promptRef}>
              <ChatComposer
                composerDisabled={composerDisabled}
                disabledReason={composerDisabledReason}
                initialInput={messages.length === 0 ? q : undefined}
                isStreaming={isStreaming}
                model={currentModel}
                onAbort={
                  activeSession && activeComposerState?.canAbort
                    ? runtime.abort
                    : () => {}
                }
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
