import { ArrowRightIcon } from "@phosphor-icons/react"
import { GithubRepo } from "@/components/github-repo"
import { CHAT_SUGGESTIONS } from "@/components/chat-suggestions"
import { buildRepoPathname } from "@/repo/url"
import type { RepoSource } from "@/types/storage"

type ChatEmptyStateProps = {
  onSuggestionClick: (text: string) => void
  onSwitchRepo?: () => void
  repoSource?: RepoSource
}

export function ChatEmptyState({
  onSuggestionClick,
  onSwitchRepo,
  repoSource,
}: ChatEmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <h2 className="font-geist-pixel-square text-2xl font-semibold tracking-tight text-foreground">
          Let&apos;s inspect
        </h2>

        {repoSource ? (
          <GithubRepo
            isLink={false}
            owner={repoSource.owner}
            ref={repoSource.ref}
            repo={repoSource.repo}
            to={buildRepoPathname(
              repoSource.owner,
              repoSource.repo,
              repoSource.ref !== "main" ? repoSource.ref : undefined
            )}
          />
        ) : null}

        <div className="flex w-full flex-col">
          {CHAT_SUGGESTIONS.map((suggestion) => (
            <button
              className="w-full px-3 py-1.5 text-left text-sm text-muted-foreground/70 transition-colors hover:bg-muted/50 hover:text-foreground"
              key={suggestion}
              onClick={() => onSuggestionClick(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>

        {onSwitchRepo ? (
          <>
            <div className="h-px w-full bg-border/40" />
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={onSwitchRepo}
              type="button"
            >
              Switch to a different repository
              <ArrowRightIcon className="size-3" weight="bold" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
