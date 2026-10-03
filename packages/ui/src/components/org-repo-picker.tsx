import * as React from "react";

import { GithubRepo } from "@gitinspect/ui/components/github-repo";
import { LetsInspectHeading } from "@gitinspect/ui/components/chat-empty-state";
import { StatusShimmer } from "@gitinspect/ui/components/ai-elements/shimmer";
import { fetchPublicReposForLogin } from "@gitinspect/runtime/repo/github-owner-repos";
import { cn } from "@gitinspect/ui/lib/utils";

type OrgRepoPickerProps = {
  ownerLogin: string;
  className?: string;
};

export function OrgRepoPicker({ ownerLogin, className }: OrgRepoPickerProps) {
  const [state, setState] = React.useState<
    | { phase: "loading" }
    | { phase: "ok"; repos: string[] }
    | { phase: "empty" }
    | { phase: "not_found" }
    | { phase: "error" }
  >({ phase: "loading" });

  React.useEffect(() => {
    const ac = new AbortController();
    setState({ phase: "loading" });

    void (async () => {
      const result = await fetchPublicReposForLogin(ownerLogin, { signal: ac.signal });
      if (ac.signal.aborted) {
        return;
      }

      if (result.status === "not_found") {
        setState({ phase: "not_found" });
        return;
      }

      if (result.status === "error") {
        setState({ phase: "error" });
        return;
      }

      if (result.repos.length === 0) {
        setState({ phase: "empty" });
        return;
      }

      setState({ phase: "ok", repos: result.repos });
    })();

    return () => ac.abort();
  }, [ownerLogin]);

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center px-6 py-8",
        state.phase === "loading" ? "justify-center" : "justify-start",
        className,
      )}
    >
      <div className="flex w-full max-w-md flex-col items-center gap-4">
        <LetsInspectHeading />
        <p className="text-center text-sm text-muted-foreground">
          Choose a repository under{" "}
          <span className="font-medium text-foreground">{ownerLogin}</span> to inspect.
        </p>

        {state.phase === "loading" ? <StatusShimmer>Loading repositories…</StatusShimmer> : null}

        {state.phase === "not_found" ? (
          <p className="text-center text-sm text-muted-foreground">
            No GitHub user or organization matches this name.
          </p>
        ) : null}

        {state.phase === "error" ? (
          <p className="text-center text-sm text-muted-foreground">
            Could not load repositories. Try again, or connect GitHub in settings if this is a
            private account.
          </p>
        ) : null}

        {state.phase === "empty" ? (
          <p className="text-center text-sm text-muted-foreground">
            No public repositories found for this account.
          </p>
        ) : null}

        {state.phase === "ok" ? (
          <ul className="flex w-full min-h-0 max-h-[min(60vh,28rem)] flex-col gap-2 overflow-y-auto pb-2">
            {state.repos.map((repo) => (
              <li className="min-w-0" key={repo}>
                <GithubRepo
                  isLink
                  owner={ownerLogin}
                  refOrigin="default"
                  repo={repo}
                  to={`/${encodeURIComponent(ownerLogin)}/${encodeURIComponent(repo)}`}
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
