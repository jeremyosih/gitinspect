import * as React from "react";
import type { GitHubAuthState, GitHubNoticeCtaIntent } from "@gitinspect/pi/repo/github-access";

export type AuthDialogVariant = "default" | "first-message";
export type AuthDialogMode = "full" | "github-only";

export type PendingAuthAction = {
  content: string;
  route: string;
  type: "send-first-message";
};

export type GitHubAuthContextValue = {
  authState: GitHubAuthState;
  closeAuthDialog: () => void;
  consumeReadyAuthAction: () => PendingAuthAction | null;
  continueAsGuest: () => Promise<void>;
  dialogMode: AuthDialogMode;
  dialogOpen: boolean;
  dialogVariant: AuthDialogVariant;
  ensureRepoAccess: () => Promise<void>;
  openAuthDialog: (input?: {
    mode?: AuthDialogMode;
    postAuthAction?: PendingAuthAction;
    variant?: AuthDialogVariant;
  }) => void;
  openGithubSettings: () => void;
  runNoticeIntent: (intent: GitHubNoticeCtaIntent) => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const GitHubAuthContext = React.createContext<GitHubAuthContextValue | null>(null);

export function GitHubAuthProvider(props: {
  children: React.ReactNode;
  value: GitHubAuthContextValue;
}) {
  return (
    <GitHubAuthContext.Provider value={props.value}>{props.children}</GitHubAuthContext.Provider>
  );
}

export function useGitHubAuthContext(): GitHubAuthContextValue | null {
  return React.useContext(GitHubAuthContext);
}
