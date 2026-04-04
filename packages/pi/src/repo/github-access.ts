export type GitHubAccessFailureReason =
  | "signed-out"
  | "oauth-not-linked"
  | "oauth-missing-scope"
  | "oauth-failed"
  | "no-fallback-token"
  | "none";

export type GitHubAccess =
  | {
      ok: true;
      source: "oauth" | "pat";
      token: string;
      scopes?: string[];
    }
  | {
      ok: false;
      reason: GitHubAccessFailureReason;
    };

export type GitHubAuthState = {
  session: "signed-in" | "signed-out";
  githubLink: "linked" | "unlinked" | "unknown";
  repoAccess: "granted" | "missing" | "unknown";
  fallbackPat: boolean;
  preferredSource: "oauth" | "pat" | "none";
};

export type ResolveGitHubAccessOptions = {
  requireRepoScope?: boolean;
};

export type GitHubAccessResolver = (options?: ResolveGitHubAccessOptions) => Promise<GitHubAccess>;

let resolver: GitHubAccessResolver | undefined;

export function registerGitHubAccessResolver(nextResolver: GitHubAccessResolver | undefined): void {
  resolver = nextResolver;
}

export async function resolveRegisteredGitHubAccess(
  options?: ResolveGitHubAccessOptions,
): Promise<GitHubAccess> {
  if (!resolver) {
    const { getGithubPersonalAccessToken } = await import("@gitinspect/pi/repo/github-token");
    const token = await getGithubPersonalAccessToken();

    if (token) {
      return {
        ok: true,
        source: "pat",
        token,
      };
    }

    return {
      ok: false,
      reason: "none",
    };
  }

  return await resolver(options);
}

export type GitHubNoticeCtaIntent =
  | "settings"
  | "sign-in"
  | "connect"
  | "grant-repo-access"
  | "reconnect"
  | "use-pat";

export function getGitHubNoticeCta(input: { kind?: string; state: GitHubAuthState }): {
  intent: GitHubNoticeCtaIntent;
  label: string;
} {
  const { kind, state } = input;

  if (state.session === "signed-out") {
    return {
      intent: "sign-in",
      label: "Sign in with GitHub",
    };
  }

  if (kind === "github_auth") {
    return {
      intent: "reconnect",
      label: "Reconnect GitHub",
    };
  }

  if (state.githubLink === "unlinked") {
    return {
      intent: "connect",
      label: "Connect GitHub",
    };
  }

  if (state.repoAccess === "missing") {
    return {
      intent: "grant-repo-access",
      label: "Grant repo access",
    };
  }

  if (state.preferredSource === "pat") {
    return {
      intent: "use-pat",
      label: "Use PAT token instead",
    };
  }

  return {
    intent: "settings",
    label: "GitHub settings",
  };
}
