import * as React from "react";
import { githubApiFetch } from "@gitinspect/runtime/repo/github-fetch";

/** Public app repo linked from the header and mobile menu (stars from GitHub API). */
export const GITHUB_APP_REPO = {
  owner: "jeremyosih",
  repo: "gitinspect",
} as const;

export function useGitHubRepoStargazers(owner: string, repo: string) {
  const [state, setState] = React.useState<
    { status: "loading" } | { status: "ok"; count: number } | { status: "error" }
  >({ status: "loading" });

  React.useEffect(() => {
    const ac = new AbortController();

    void (async () => {
      try {
        const response = await githubApiFetch(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
          {
            access: "public",
            signal: ac.signal,
          },
        );

        if (!response.ok) {
          setState({ status: "error" });
          return;
        }

        const data = (await response.json()) as { stargazers_count: number };
        setState({ status: "ok", count: data.stargazers_count });
      } catch {
        if (!ac.signal.aborted) {
          setState({ status: "error" });
        }
      }
    })();

    return () => ac.abort();
  }, [owner, repo]);

  return state;
}
