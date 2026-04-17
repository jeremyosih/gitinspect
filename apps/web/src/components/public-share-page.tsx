import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { buildForkPromptFromSharedSession } from "@gitinspect/pi/lib/public-share";
import { repoSourceToGitHubUrl } from "@gitinspect/pi/repo/url";
import {
  persistLastUsedSessionSettings,
  resolveProviderDefaults,
} from "@gitinspect/pi/sessions/session-actions";
import { getCanonicalProvider } from "@gitinspect/pi/models/catalog";
import type { ProviderGroupId, ThinkingLevel } from "@gitinspect/pi/types/models";
import { ChatComposer } from "@gitinspect/ui/components/chat-composer";
import { ChatMessage as ChatMessageBlock } from "@gitinspect/ui/components/chat-message";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@gitinspect/ui/components/ai-elements/conversation";
import { StatusShimmer } from "@gitinspect/ui/components/ai-elements/shimmer";
import { Button } from "@gitinspect/ui/components/button";
import { Icons } from "@gitinspect/ui/components/icons";
import { ProgressiveBlur } from "@gitinspect/ui/components/progressive-blur";
import { useConversationStarter } from "@gitinspect/ui/hooks/use-conversation-starter";
import { getFoldedToolResultIds } from "@gitinspect/pi/lib/chat-adapter";
import {
  loadPublicSessionSnapshot,
  type PublicSessionSnapshot,
} from "@gitinspect/pi/lib/public-share-client";
import { setPublicShareHeaderRepo } from "@gitinspect/ui/lib/public-share-header-bridge";

type Draft = {
  model: string;
  providerGroup: ProviderGroupId;
  thinkingLevel: ThinkingLevel;
};

function SharedTranscriptLoading() {
  return (
    <div className="flex min-h-svh items-center justify-center px-6 text-sm text-muted-foreground">
      <StatusShimmer>Loading shared transcript...</StatusShimmer>
    </div>
  );
}

function SharedTranscriptNotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-lg font-medium">Shared transcript not found</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          This link may have expired, been removed, or never existed.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link
          search={{ feedback: undefined, settings: undefined, sidebar: undefined, tab: undefined }}
          to="/"
        >
          Go home
        </Link>
      </Button>
    </div>
  );
}

function SharedTranscriptError(props: { message: string }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="space-y-2">
        <h1 className="text-lg font-medium">Could not load shared transcript</h1>
        <p className="max-w-md text-sm text-muted-foreground">{props.message}</p>
      </div>
      <Button asChild variant="outline">
        <Link
          search={{ feedback: undefined, settings: undefined, sidebar: undefined, tab: undefined }}
          to="/"
        >
          Go home
        </Link>
      </Button>
    </div>
  );
}

export function PublicSharePage(props: {
  initialSnapshot?: PublicSessionSnapshot | null;
  sessionId: string;
}) {
  const {
    data: snapshot,
    error: queryError,
    isError,
    isPending,
    isSuccess,
  } = useQuery({
    initialData: props.initialSnapshot ?? undefined,
    queryFn: () => loadPublicSessionSnapshot(props.sessionId),
    queryKey: ["public-session", props.sessionId],
    refetchInterval: 3_000,
    retry: false,
    staleTime: 2_000,
  });

  React.useEffect(() => {
    setPublicShareHeaderRepo(undefined);
  }, [props.sessionId]);

  React.useEffect(() => {
    const repoSource = snapshot?.session.repoSource;

    if (!repoSource) {
      setPublicShareHeaderRepo(undefined);
      return () => {
        setPublicShareHeaderRepo(undefined);
      };
    }

    setPublicShareHeaderRepo({
      owner: repoSource.owner,
      ref: repoSource.ref,
      repo: repoSource.repo,
    });

    return () => {
      setPublicShareHeaderRepo(undefined);
    };
  }, [snapshot]);

  const defaults = useLiveQuery(async () => {
    const resolved = await resolveProviderDefaults();

    return {
      model: resolved.model,
      providerGroup: resolved.providerGroup,
      thinkingLevel: "medium" as ThinkingLevel,
    } satisfies Draft;
  }, []);
  const [draft, setDraft] = React.useState<Draft | undefined>(undefined);
  const { isStartingSession, startNewConversation } = useConversationStarter();
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const [promptHeight, setPromptHeight] = React.useState(0);

  const promptRef = React.useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateHeight = () => {
      setPromptHeight(node.offsetHeight);
    };

    updateHeight();

    observerRef.current = new ResizeObserver(updateHeight);
    observerRef.current.observe(node);
  }, []);

  React.useEffect(() => {
    if (!defaults) {
      return;
    }

    setDraft((currentDraft) => currentDraft ?? defaults);
  }, [defaults]);

  const persistDraft = React.useCallback((nextDraft: Draft) => {
    setDraft(nextDraft);
    void persistLastUsedSessionSettings({
      model: nextDraft.model,
      provider: getCanonicalProvider(nextDraft.providerGroup),
      providerGroup: nextDraft.providerGroup,
    });
  }, []);

  const handleSend = React.useCallback(
    async (prompt: string) => {
      if (!snapshot || !draft) {
        return;
      }

      const forkPrompt = buildForkPromptFromSharedSession({
        messages: snapshot.messages,
        prompt,
        repoSource: snapshot.session.repoSource,
        sourceUrl: snapshot.session.sourceUrl,
      });
      const session = await startNewConversation({
        initialPrompt: forkPrompt,
        model: draft.model,
        providerGroup: draft.providerGroup,
        repoSource: snapshot.session.repoSource,
        sourceUrl: snapshot.session.sourceUrl,
        thinkingLevel: draft.thinkingLevel,
      });

      if (session) {
        toast.success("Started a new private conversation");
      }
    },
    [draft, snapshot, startNewConversation],
  );

  if (isPending && snapshot === undefined) {
    return <SharedTranscriptLoading />;
  }

  if (isError && snapshot === undefined) {
    const message = queryError instanceof Error ? queryError.message : "Unknown error";
    return <SharedTranscriptError message={message} />;
  }

  if (isSuccess && snapshot === undefined) {
    return <SharedTranscriptNotFound />;
  }

  if (!snapshot) {
    return <SharedTranscriptLoading />;
  }

  if (!draft) {
    return <SharedTranscriptLoading />;
  }

  const foldedToolResultIds = getFoldedToolResultIds(snapshot.messages);
  const repoUrl = snapshot.session.repoSource
    ? repoSourceToGitHubUrl(snapshot.session.repoSource)
    : snapshot.session.sourceUrl;
  const repoLabel = snapshot.session.repoSource
    ? `${snapshot.session.repoSource.owner}/${snapshot.session.repoSource.repo} · ${snapshot.session.repoSource.ref}`
    : repoUrl;

  return (
    <div
      className="relative flex size-full min-h-0 flex-col overflow-hidden bg-background"
      style={{ "--chat-input-height": `${promptHeight}px` } as React.CSSProperties}
    >
      <Conversation className="min-h-0 flex-1">
        <ConversationContent
          className={`mx-auto w-full max-w-4xl px-4 py-6 ${
            snapshot.messages.length === 0 ? "min-h-full" : ""
          }`}
        >
          {snapshot.messages.map((message, index) => {
            if (message.role === "toolResult" && foldedToolResultIds.has(message.id)) {
              return null;
            }

            return (
              <ChatMessageBlock
                followingMessages={snapshot.messages.slice(index + 1)}
                isStreamingReasoning={false}
                key={message.id}
                message={message}
              />
            );
          })}
        </ConversationContent>
        <ConversationScrollButton className="z-[15]" />
        {snapshot.messages.length > 0 ? (
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
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Icons.Globe className="size-3.5 shrink-0" />
              <span className="shrink-0">Shared session</span>
              {snapshot.session.title.trim().length > 0 ? (
                <>
                  <span className="shrink-0">·</span>
                  <span className="min-w-0 truncate font-medium text-foreground/80">
                    {snapshot.session.title}
                  </span>
                </>
              ) : null}
              {repoUrl ? (
                <>
                  <span className="shrink-0">·</span>
                  <a
                    className="min-w-0 truncate underline underline-offset-4 hover:text-foreground"
                    href={repoUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {repoLabel}
                  </a>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="pointer-events-auto bg-background">
          <div className="mx-auto w-full max-w-4xl px-4 pb-4">
            <p className="mb-2 text-xs text-muted-foreground">
              Sending a message starts your own private conversation.
            </p>
            <div ref={promptRef}>
              <ChatComposer
                composerDisabled={isStartingSession}
                disabledReason={
                  isStartingSession ? "Starting your private conversation..." : undefined
                }
                isStreaming={isStartingSession}
                model={draft.model}
                onAbort={() => {}}
                onSelectModel={(providerGroup, model) => {
                  persistDraft({
                    model,
                    providerGroup,
                    thinkingLevel: draft.thinkingLevel,
                  });
                }}
                onSend={handleSend}
                onThinkingLevelChange={(thinkingLevel) => {
                  persistDraft({
                    model: draft.model,
                    providerGroup: draft.providerGroup,
                    thinkingLevel,
                  });
                }}
                placeholder="Ask a follow-up privately"
                providerGroup={draft.providerGroup}
                thinkingLevel={draft.thinkingLevel}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
