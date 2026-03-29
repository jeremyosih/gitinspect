import { Link } from "@tanstack/react-router"
import { AlertCircle, AlertTriangle, Info } from "lucide-react"
import {
  deriveAssistantView,
  getUserText,
  isSystemMessage,
  isToolResultMessage,
} from "./chat-adapter"
import type { ChatMessage as ChatMessageType } from "@/types/chat"
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
import { StatusShimmer } from "@/components/ai-elements/shimmer"
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources"
import { ToolExecution } from "@/components/tool-execution"
import { ToolResultBubble } from "@/components/tool-result-bubble"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Button } from "@/components/ui/button"

export function ChatMessage(props: {
  followingMessages?: ReadonlyArray<ChatMessageType>
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

  if (isSystemMessage(message)) {
    const severity = message.severity
    const tone =
      severity === "error"
        ? "bg-red-100 text-red-900 dark:bg-red-950/30 dark:text-red-200"
        : severity === "warning"
          ? "bg-amber-100 text-amber-950 dark:bg-amber-950/25 dark:text-amber-100"
          : "bg-muted/40 text-foreground"

    const icon =
      severity === "error" ? (
        <AlertCircle className="size-4 text-red-600 dark:text-red-400" />
      ) : severity === "warning" ? (
        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
      ) : (
        <Info className="size-4 text-muted-foreground" />
      )

    const showGithubCta = message.action === "open-github-settings"

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
          </ItemContent>
          {showGithubCta ? (
            <ItemActions className="shrink-0">
              <Button asChild size="sm" variant="outline">
                <Link
                  search={(prev) => ({
                    ...prev,
                    settings: "github",
                  })}
                  to="."
                >
                  {message.kind === "github_rate_limit"
                    ? "Add GitHub token"
                    : "GitHub settings"}
                </Link>
              </Button>
            </ItemActions>
          ) : null}
        </Item>
      </div>
    )
  }

  const view = deriveAssistantView(message, props.followingMessages)
  const isStreamingAssistant =
    "status" in message && message.status === "streaming"
  const showStreamingPlaceholder =
    isStreamingAssistant &&
    view.text.length === 0 &&
    view.reasoning.length === 0 &&
    view.toolExecutions.length === 0

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
          <ToolExecution
            key={toolCall.id}
            toolCall={toolCall}
            toolResult={toolResult}
          />
        ))}
      </div>
    </Message>
  )
}
