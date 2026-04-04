import * as React from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { authClient } from "@/lib/auth-client";
import { deriveGitHubAuthState } from "@/lib/github-access";
import { getGithubPersonalAccessToken } from "@gitinspect/pi/repo/github-token";
import type { GitHubAuthState } from "@gitinspect/pi/repo/github-access";

const DEFAULT_AUTH_STATE: GitHubAuthState = {
  fallbackPat: false,
  githubLink: "unlinked",
  preferredSource: "none",
  repoAccess: "missing",
  session: "signed-out",
};

export function useGithubAuth() {
  const sessionState = authClient.useSession();
  const [authState, setAuthState] = React.useState<GitHubAuthState>(DEFAULT_AUTH_STATE);
  const [isPending, setIsPending] = React.useState(true);
  const pat = useLiveQuery(async () => await getGithubPersonalAccessToken(), []);

  const refresh = React.useCallback(async () => {
    setIsPending(true);

    try {
      setAuthState(await deriveGitHubAuthState());
    } finally {
      setIsPending(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [pat, refresh, sessionState.data]);

  return {
    authState,
    isPending,
    refresh,
    sessionState,
  };
}
