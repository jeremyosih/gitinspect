import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import type { ResolvedRepoSource } from "@gitinspect/db";
import { listRepositories } from "@gitinspect/db";
import { handleGithubError } from "@gitinspect/pi/repo/github-fetch";
import { parseRepoInput } from "@gitinspect/pi/repo/path-parser";
import { resolveRepoIntent } from "@gitinspect/pi/repo/ref-resolver";
import { SUGGESTED_REPOS } from "@gitinspect/pi/repo/suggested-repos";
import { githubOwnerAvatarUrl, repoSourceToPath } from "@gitinspect/pi/repo/url";
import { Icons } from "@gitinspect/ui/components/icons";
import { cn } from "@gitinspect/ui/lib/utils";

export type RepoComboboxHandle = {
  focusAndClear: () => void;
};

type RepoComboboxProps = {
  autoFocus?: boolean;
  className?: string;
  repoSource?: ResolvedRepoSource;
  sessionId?: string;
};

type Mode = "display" | "edit";

export const RepoCombobox = React.forwardRef<RepoComboboxHandle, RepoComboboxProps>(
  function RepoComboboxInner({ autoFocus = false, className, repoSource, sessionId }, ref) {
    const navigate = useNavigate();
    const search = useSearch({ strict: false });
    const settings = typeof search.settings === "string" ? search.settings : undefined;
    const sidebar = search.sidebar === "open" ? "open" : undefined;
    const q = typeof search.q === "string" && search.q.trim().length > 0 ? search.q : undefined;
    const repositories = useLiveQuery(async () => await listRepositories(), []);
    const [mode, setMode] = React.useState<Mode>(repoSource && !autoFocus ? "display" : "edit");
    const [query, setQuery] = React.useState("");
    const [isValidating, setIsValidating] = React.useState(false);
    const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const hasRecentRepos = (repositories?.length ?? 0) > 0;

    const listItems = React.useMemo(() => {
      if (repositories === undefined) {
        return [];
      }

      if (hasRecentRepos) {
        if (!query.trim()) {
          return repositories.slice(0, 5);
        }

        const lower = query.toLowerCase();

        return repositories
          .filter((r) => `${r.owner}/${r.repo}`.toLowerCase().includes(lower))
          .slice(0, 5);
      }

      if (!query.trim()) {
        return SUGGESTED_REPOS.slice(0, 5);
      }

      const lower = query.toLowerCase();

      return SUGGESTED_REPOS.filter((r) =>
        `${r.owner}/${r.repo}`.toLowerCase().includes(lower),
      ).slice(0, 5);
    }, [repositories, hasRecentRepos, query]);

    const showDropdown = mode === "edit" && listItems.length > 0;

    React.useImperativeHandle(ref, () => ({
      focusAndClear() {
        setQuery("");
        setMode("edit");
      },
    }));

    React.useEffect(() => {
      if (mode === "edit" && inputRef.current) {
        inputRef.current.focus();
      }
    }, [mode]);

    React.useEffect(() => {
      if (autoFocus && !repoSource) {
        setMode("edit");
      }
    }, [autoFocus, repoSource]);

    React.useEffect(() => {
      setHighlightedIndex(-1);
    }, [query]);

    const navigateToRepo = React.useCallback(
      (path: string) => {
        void navigate({
          search: {
            q,
            settings,
            sidebar,
          },
          to: path,
        });
      },
      [navigate, q, settings, sidebar],
    );

    const handleSelect = React.useCallback(
      (path: string) => {
        setQuery("");
        setMode("display");
        navigateToRepo(path);
      },
      [navigateToRepo],
    );

    const handleSubmit = React.useCallback(async () => {
      if (highlightedIndex >= 0 && highlightedIndex < listItems.length) {
        const item = listItems[highlightedIndex];
        if (item) {
          handleSelect(repoSourceToPath(item));
        }
        return;
      }

      const intent = parseRepoInput(query);
      if (intent.type === "invalid") {
        toast.error("Enter a valid owner/repo or GitHub URL");
        return;
      }

      setIsValidating(true);
      try {
        const resolved = await resolveRepoIntent(intent);
        setQuery("");
        setMode("display");
        navigateToRepo(repoSourceToPath(resolved));
      } catch (err) {
        if (!(await handleGithubError(err, { sessionId }))) {
          toast.error("Failed to validate repository");
        }
      } finally {
        setIsValidating(false);
      }
    }, [query, highlightedIndex, listItems, handleSelect, navigateToRepo, sessionId]);

    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void handleSubmit();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          if (repoSource) {
            setMode("display");
            setQuery("");
          }
          return;
        }
        if (e.key === "ArrowDown" && showDropdown) {
          e.preventDefault();
          setHighlightedIndex((i) => (i < listItems.length - 1 ? i + 1 : 0));
          return;
        }
        if (e.key === "ArrowUp" && showDropdown) {
          e.preventDefault();
          setHighlightedIndex((i) => (i > 0 ? i - 1 : listItems.length - 1));
        }
      },
      [handleSubmit, listItems.length, repoSource, showDropdown],
    );

    React.useEffect(() => {
      if (mode !== "edit") return;

      function handleClickOutside(e: MouseEvent) {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          if (repoSource) {
            setMode("display");
            setQuery("");
          }
        }
      }

      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [mode, repoSource]);

    if (mode === "display" && repoSource) {
      return (
        <button
          className={cn(
            "flex w-fit items-center gap-1.5 rounded-sm border border-border/50 bg-muted px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted",
            className,
          )}
          onClick={() => setMode("edit")}
          type="button"
        >
          <OwnerAvatar owner={repoSource.owner} size="sm" />
          <span className="whitespace-nowrap font-mono text-xs">
            {repoSource.owner}/{repoSource.repo}
          </span>
        </button>
      );
    }

    return (
      <div ref={containerRef} className={cn("relative w-fit", className)}>
        <div className="flex w-fit items-center gap-1.5 rounded-sm border border-border/50 bg-muted px-2 py-1">
          <Icons.gitHub className="size-3 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            aria-label="Repository (owner/repo)"
            autoComplete="off"
            className="w-[140px] bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            disabled={isValidating}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="owner/repo"
            value={query}
          />
          <span className="flex size-3 shrink-0 items-center justify-center">
            {isValidating ? (
              <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
            ) : null}
          </span>
        </div>

        {showDropdown ? (
          <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[200px] overflow-hidden rounded-sm border border-border bg-popover shadow-md">
            <div className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {hasRecentRepos ? (
                <>
                  <Icons.clock className="size-2.5" />
                  Recent
                </>
              ) : (
                <>
                  <Icons.sparkles className="size-2.5" />
                  Suggested Repo
                </>
              )}
            </div>
            {listItems.map((repo, index) => (
              <button
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent",
                  highlightedIndex === index && "bg-accent",
                )}
                key={`${repo.owner}/${repo.repo}@${repo.ref}`}
                onClick={() => handleSelect(repoSourceToPath(repo))}
                type="button"
              >
                <OwnerAvatar owner={repo.owner} size="sm" />
                <span className="truncate font-mono text-xs">
                  {repo.owner}/{repo.repo}
                  {repo.refOrigin !== "default" ? (
                    <span className="text-muted-foreground">@{repo.ref}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  },
);

function OwnerAvatar({ owner, size = "sm" }: { owner: string; size?: "sm" | "md" }) {
  const [failed, setFailed] = React.useState(false);
  const sizeClass = size === "sm" ? "size-3" : "size-4";

  return (
    <div className={cn("shrink-0 overflow-hidden rounded-full", sizeClass)}>
      {failed ? (
        <Icons.gitHub className={cn(sizeClass, "text-muted-foreground")} />
      ) : (
        <img
          alt=""
          className="size-full object-cover"
          onError={() => setFailed(true)}
          src={githubOwnerAvatarUrl(owner)}
        />
      )}
    </div>
  );
}
