import type { GitHubAuthState } from "@gitinspect/runtime/repo/github-access";

export type GitHubConnectionSummary = {
  accountStatus: string;
  chipLabel: string;
  chipVariant: "default" | "outline" | "secondary";
  localTokenStatus: string;
  primaryAction: "grant-repo-access" | "none" | "reconnect" | "sign-in";
  primaryLabel: string | null;
  privateRepoStatus: string;
};

export function getGitHubConnectionSummary(state: GitHubAuthState): GitHubConnectionSummary {
  const localTokenStatus = state.fallbackPat ? "Saved on this browser" : "Not saved";

  if (state.session === "signed-out") {
    return {
      accountStatus: "Signed out",
      chipLabel: state.fallbackPat ? "Local token" : "Signed out",
      chipVariant: "outline",
      localTokenStatus,
      primaryAction: "sign-in",
      primaryLabel: "Sign in with GitHub",
      privateRepoStatus: state.fallbackPat ? "Available with local token" : "Public repos only",
    };
  }

  if (state.repoAccess === "granted") {
    return {
      accountStatus: "Signed in",
      chipLabel: "Private repos enabled",
      chipVariant: "secondary",
      localTokenStatus,
      primaryAction: "none",
      primaryLabel: null,
      privateRepoStatus: "Enabled",
    };
  }

  if (state.repoAccess === "missing") {
    return {
      accountStatus: "Signed in",
      chipLabel: "Signed in",
      chipVariant: "outline",
      localTokenStatus,
      primaryAction: "grant-repo-access",
      primaryLabel: "Enable private repo access",
      privateRepoStatus: "Not enabled yet",
    };
  }

  return {
    accountStatus: "Signed in",
    chipLabel: "Check GitHub",
    chipVariant: "outline",
    localTokenStatus,
    primaryAction: "reconnect",
    primaryLabel: "Reconnect GitHub",
    privateRepoStatus: "Reconnect needed",
  };
}
