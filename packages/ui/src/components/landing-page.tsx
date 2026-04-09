import * as React from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { listRepositories } from "@gitinspect/db";
import { handleGithubError } from "@gitinspect/pi/repo/github-fetch";
import { parseRepoInput } from "@gitinspect/pi/repo/path-parser";
import { resolveRepoIntent } from "@gitinspect/pi/repo/ref-resolver";
import { SUGGESTED_REPOS } from "@gitinspect/pi/repo/suggested-repos";
import { repoSourceToPath } from "@gitinspect/pi/repo/url";
import { ChatLogo } from "@gitinspect/ui/components/chat-logo";
import { GithubRepo } from "@gitinspect/ui/components/github-repo";
import { Icons } from "@gitinspect/ui/components/icons";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from "@gitinspect/ui/components/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@gitinspect/ui/components/tabs";
import { cn } from "@gitinspect/ui/lib/utils";

function useSuggestedRepos(count: number) {
  return React.useMemo(() => {
    const shuffled = [...SUGGESTED_REPOS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }, [count]);
}

export function LandingPage() {
  const search = useSearch({ from: "/" });
  const tab = search.tab;
  const settings = typeof search.settings === "string" ? search.settings : undefined;
  const sidebar = search.sidebar === "open" ? "open" : undefined;
  const repositories = useLiveQuery(async () => await listRepositories(), []);
  const recentRepos = React.useMemo(() => (repositories ?? []).slice(0, 4), [repositories]);
  const hasRecent = recentRepos.length > 0;
  const suggestedRepos = useSuggestedRepos(4);
  const resolvedTab = tab ?? (hasRecent ? "recent" : "suggested");

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center overflow-auto p-6 pt-[12vh] lg:justify-between lg:overflow-hidden lg:pt-6 lg:pb-5">
      <div className="w-full max-w-xl flex-1 space-y-8 lg:min-h-0 lg:flex lg:flex-col lg:justify-center lg:space-y-5">
        <div className="space-y-6 text-center lg:space-y-4">
          <h1 className="sr-only">gitinspect</h1>
          <ChatLogo
            aria-hidden
            className="[&_.font-geist-pixel-square]:lg:text-7xl [&_.font-geist-pixel-square]:xl:text-8xl"
            size="hero"
          />
          <p className="max-w-md mx-auto text-sm text-muted-foreground">
            Gitinspect is an AI coding agent that lives on your browser and can answer questions
            about any GitHub repository.
          </p>
        </div>

        <div className="space-y-2 lg:space-y-1.5">
          <LandingRepoForm />
          <p className="text-center text-[11px] text-muted-foreground/60">
            You can also replace &apos;hub&apos; with &apos;inspect&apos; in any GitHub URL.
          </p>
        </div>

        <Tabs value={resolvedTab}>
          <div className="mb-3 flex justify-center lg:mb-2">
            <TabsList variant="line">
              <TabsTrigger asChild disabled={!hasRecent} value="recent">
                <Link replace search={{ settings, sidebar, tab: "recent" }} to="/">
                  <Icons.clock className="size-3" />
                  Recent
                </Link>
              </TabsTrigger>
              <TabsTrigger asChild value="suggested">
                <Link replace search={{ settings, sidebar, tab: "suggested" }} to="/">
                  <Icons.sparkles className="size-3" />
                  Suggested
                </Link>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="recent">
            <ul className="space-y-1.5">
              {recentRepos.map((row) => {
                const to = repoSourceToPath(row);
                return (
                  <li key={`${row.owner}/${row.repo}@${row.ref}`}>
                    <GithubRepo
                      owner={row.owner}
                      ref={row.ref}
                      refOrigin={row.refOrigin}
                      repo={row.repo}
                      search={{ settings, sidebar }}
                      to={to}
                    />
                  </li>
                );
              })}
            </ul>
          </TabsContent>

          <TabsContent value="suggested">
            <ul className="space-y-1.5">
              {suggestedRepos.map((row) => {
                const to = repoSourceToPath(row);
                return (
                  <li key={`${row.owner}/${row.repo}`}>
                    <GithubRepo
                      owner={row.owner}
                      ref={row.ref}
                      refOrigin={row.refOrigin}
                      repo={row.repo}
                      search={{ settings, sidebar }}
                      to={to}
                    />
                  </li>
                );
              })}
            </ul>
          </TabsContent>
        </Tabs>
      </div>

      <footer className="mt-auto w-full max-w-xl shrink-0 pt-16 pb-8 text-center lg:mt-0 lg:pt-4 lg:pb-0">
        <p className="text-sm text-muted-foreground">
          Made by{" "}
          <a
            className="underline underline-offset-2 decoration-muted-foreground/60 hover:text-foreground hover:decoration-foreground/60"
            href="https://jeremyosih.com/"
            rel="noopener noreferrer"
            target="_blank"
          >
            Jeremy Osih
          </a>
        </p>
        <p className="mt-2 max-w-md mx-auto text-[11px] leading-relaxed text-muted-foreground/70">
          Chats and repo data stay local in your browser. If you sign in, gitinspect stores a secure
          session cookie for your account. Private repo access uses GitHub OAuth or an optional
          local access token.
        </p>
      </footer>
    </div>
  );
}

function LandingRepoForm() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/" });
  const settings = typeof search.settings === "string" ? search.settings : undefined;
  const sidebar = search.sidebar === "open" ? "open" : undefined;
  const [query, setQuery] = React.useState("");
  const [isValidating, setIsValidating] = React.useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isValidating) return;

    const intent = parseRepoInput(query);
    if (intent.type === "invalid") return;

    setIsValidating(true);
    try {
      const resolved = await resolveRepoIntent(intent);
      const path = repoSourceToPath(resolved);
      void navigate({
        search: {
          settings,
          sidebar,
        },
        to: path,
      });
    } catch (err) {
      if (!(await handleGithubError(err))) {
        const { toast } = await import("sonner");
        toast.error("Failed to validate repository");
      }
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)}>
      <InputGroup
        className={cn(
          "h-11 min-h-11 w-full min-w-0 rounded-none border border-foreground/20 bg-sidebar shadow-none",
          "transition-colors hover:bg-sidebar-accent focus-within:bg-sidebar-accent",
          "has-[[data-slot=input-group-control]:focus-visible]:border-foreground/30",
          "has-[[data-slot=input-group-control]:focus-visible]:ring-0",
          "dark:bg-sidebar",
        )}
      >
        <InputGroupAddon align="inline-start" className="pl-3.5">
          <InputGroupText className="gap-1.5 text-sidebar-foreground">
            <Icons.gitHub className="size-3" />
          </InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          aria-label="GitHub repository URL or owner/repo"
          autoComplete="off"
          className="min-w-0 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50"
          disabled={isValidating}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="https://github.com/owner/repo or owner/repo"
          value={query}
        />
        <InputGroupAddon align="inline-end" className="pr-2.5">
          <span className="flex size-5 items-center justify-center">
            {isValidating ? (
              <span className="size-3.5 animate-spin rounded-full border-2 border-sidebar-foreground/30 border-t-sidebar-foreground" />
            ) : (
              <InputGroupButton
                aria-label="Continue to workspace"
                className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                size="icon-sm"
                type="submit"
                variant="ghost"
              >
                <ArrowRightIcon className="size-3.5" weight="bold" />
              </InputGroupButton>
            )}
          </span>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
