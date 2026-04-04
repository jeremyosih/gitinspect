import { Link } from "@tanstack/react-router";
import { AlertCircle, AlertTriangle, ChevronDown, Info } from "lucide-react";
import { getGitHubNoticeCta } from "@gitinspect/pi/repo/github-access";
import { useGitHubAuthContext } from "@gitinspect/ui/components/github-auth-context";
import {
  deriveAssistantView,
  getUserText,
  isSystemMessage,
  isToolResultMessage,
} from "@gitinspect/pi/lib/chat-adapter";
import type { ChatMessage as ChatMessageType } from "@gitinspect/pi/types/chat";
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
} from "@gitinspect/ui/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@gitinspect/ui/components/ai-elements/reasoning";
import { StatusShimmer } from "@gitinspect/ui/components/ai-elements/shimmer";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@gitinspect/ui/components/ai-elements/sources";
import { ToolExecution } from "@gitinspect/ui/components/tool-execution";
import { ToolResultBubble } from "@gitinspect/ui/components/tool-result-bubble";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@gitinspect/ui/components/item";
import { Button } from "@gitinspect/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@gitinspect/ui/components/collapsible";
import { cn } from "@gitinspect/ui/lib/utils";

export function ChatMessage(props: {
  followingMessages?: ReadonlyArray<ChatMessageType>;
  isStreamingReasoning: boolean;
  message: ChatMessageType;
}) {
  const { message } = props;
  const auth = useGitHubAuthContext();

  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent>
          <MessageResponse>{getUserText(message)}</MessageResponse>
        </MessageContent>
      </Message>
    );
  }

  if (isToolResultMessage(message)) {
    return <ToolResultBubble message={message} />;
  }

  if (isSystemMessage(message)) {
    const severity = message.severity;
    const tone =
      severity === "error"
        ? "bg-red-100 text-red-900 dark:bg-red-950/30 dark:text-red-200"
        : severity === "warning"
          ? "bg-amber-100 text-amber-950 dark:bg-amber-950/25 dark:text-amber-100"
          : "bg-muted/40 text-foreground";

    const icon =
      severity === "error" ? (
        <AlertCircle className="size-4 text-red-600 dark:text-red-400" />
      ) : severity === "warning" ? (
        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
      ) : (
        <Info className="size-4 text-muted-foreground" />
      );

    const showGithubCta = message.action === "open-github-settings";
    const showHtmlDetails = Boolean(message.detailsHtml);
    const githubCta = auth
      ? getGitHubNoticeCta({
          kind: message.kind,
          state: auth.authState,
        })
      : null;

    return (
      <div className="flex w-full justify-start py-1">
        <Item
          className={`max-w-full flex-1 flex-wrap items-start gap-2 rounded-lg border border-border text-sm ${tone}`}
          variant="outline"
        >
          <ItemMedia variant="icon">{icon}</ItemMedia>
          <ItemContent>
            <ItemTitle className="line-clamp-none text-[13px] font-medium">
              {message.kind.replace(/_/g, " ")}
            </ItemTitle>
            <ItemDescription className="line-clamp-none text-[13px] text-inherit opacity-90">
              {message.message}
            </ItemDescription>
            {showHtmlDetails ? (
              <Collapsible className="mt-3 overflow-hidden rounded-md border border-border/60 bg-background/70 text-foreground">
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-muted/40">
                  <span>HTML response</span>
                  <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t border-border/60 px-3 py-3">
                  <div className="space-y-3">
                    {message.detailsContext ? (
                      <p className="rounded border border-border/60 bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
                        {message.detailsContext}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Sandboxed preview for inspection only. It won&apos;t satisfy the original
                      challenge request.
                    </p>
                    <iframe
                      className="h-72 w-full rounded border border-border/60 bg-background"
                      sandbox="allow-scripts"
                      srcDoc={message.detailsHtml}
                      title={`HTML response preview ${message.id}`}
                    />
                    <pre
                      className={cn(
                        "max-h-72 overflow-auto rounded border border-border/60 bg-muted/40 p-3 font-mono text-[11px] whitespace-pre-wrap break-all",
                        "selection:bg-primary/20",
                      )}
                    >
                      {message.detailsHtml}
                    </pre>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </ItemContent>
          {showGithubCta ? (
            <ItemActions className="shrink-0">
              {auth && githubCta ? (
                <Button
                  onClick={() => {
                    void auth.runNoticeIntent(githubCta.intent);
                  }}
                  size="sm"
                  variant="outline"
                >
                  {githubCta.label}
                </Button>
              ) : (
                <Button asChild size="sm" variant="outline">
                  <Link
                    search={(prev) => ({
                      ...prev,
                      settings: "github",
                    })}
                    to="."
                  >
                    GitHub settings
                  </Link>
                </Button>
              )}
            </ItemActions>
          ) : null}
        </Item>
      </div>
    );
  }

  const view = deriveAssistantView(message, props.followingMessages);
  const isStreamingAssistant = "status" in message && message.status === "streaming";
  const showStreamingPlaceholder =
    isStreamingAssistant &&
    view.text.length === 0 &&
    view.reasoning.length === 0 &&
    view.toolExecutions.length === 0;

  return (
    <Message from="assistant">
      <div className="flex w-full flex-col gap-2">
        {showStreamingPlaceholder ? (
          <MessageContent>
            <StatusShimmer duration={1.5}>Assistant is streaming...</StatusShimmer>
          </MessageContent>
        ) : null}

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

        {view.text ? (
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
        ) : null}

        {view.toolExecutions.map(({ toolCall, toolResult }) => (
          <ToolExecution key={toolCall.id} toolCall={toolCall} toolResult={toolResult} />
        ))}
      </div>
    </Message>
  );
}
