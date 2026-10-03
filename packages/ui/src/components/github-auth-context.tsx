import * as React from "react";
import type {
  GitHubAuthState,
  GitHubNoticeCtaIntent,
} from "@gitinspect/runtime/repo/github-access";

export type AuthDialogVariant = "default" | "first-message";
export type AuthDialogMode = "full" | "github-only";
export type AuthDialogReason = "private-repo-access" | "settings";

export type PendingAuthAction = {
  content: string;
  route: string;
  type: "send-first-message";
};

export type ReadyAuthAction = {
  action: PendingAuthAction;
  requiresConfirmation: boolean;
};

export type GitHubAuthContextValue = {
  authState: GitHubAuthState;
  closeAuthDialog: () => void;
  consumeReadyAuthAction: (route: string) => ReadyAuthAction | null;
  continueAsGuest: () => Promise<void>;
  dialogMode: AuthDialogMode;
  dialogOpen: boolean;
  dialogReason: AuthDialogReason;
  dialogVariant: AuthDialogVariant;
  ensureRepoAccess: () => Promise<void>;
  openAuthDialog: (input?: {
    mode?: AuthDialogMode;
    postAuthAction?: PendingAuthAction;
    reason?: AuthDialogReason;
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
