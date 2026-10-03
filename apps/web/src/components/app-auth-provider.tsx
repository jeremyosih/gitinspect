import * as React from "react";
import { toast } from "sonner";
import {
  continuePendingGithubRepoAccessGrant,
  ensureGitHubRepoAccess,
  signInWithGithub,
  signOutGithubProductSession,
} from "@/lib/github-access";
import {
  closeAuthDialog,
  consumeReadyAuthAction,
  continueAsGuest,
  openAuthDialog,
  useAuthStore,
} from "@/store/auth-store";
import type { GitHubNoticeCtaIntent } from "@gitinspect/runtime/repo/github-access";
import { registerGitHubAuthUiBridge } from "@gitinspect/runtime/repo/github-auth-ui";
import { openGithubTokenSettings } from "@gitinspect/runtime/repo/github-fetch";
import { GitHubAuthProvider } from "@gitinspect/ui/components/github-auth-context";
import { useGithubAuth } from "@/hooks/use-github-auth";

export function AppAuthProvider(props: { children: React.ReactNode }) {
  const { authState, sessionState } = useGithubAuth();
  const authStore = useAuthStore();

  React.useEffect(() => {
    if (sessionState.data && authStore.dialogOpen) {
      closeAuthDialog();
    }
  }, [authStore.dialogOpen, sessionState.data]);

  React.useEffect(() => {
    if (!sessionState.data) {
      return;
    }

    void continuePendingGithubRepoAccessGrant()
      .then((status) => {
        if (status === "requested-grant") {
          toast.info("Step 1 of 2 complete — requesting private repo access…");
        }
      })
      .catch((error) => {
        console.error("Could not continue GitHub repo access grant", error);
      });
  }, [sessionState.data]);

  const runNoticeIntent = React.useCallback(async (intent: GitHubNoticeCtaIntent) => {
    if (intent === "sign-in") {
      openAuthDialog({
        mode: "github-only",
        reason: "settings",
      });
      return;
    }

    if (intent === "connect" || intent === "grant-repo-access") {
      openAuthDialog({
        mode: "full",
        reason: "private-repo-access",
      });
      return;
    }

    openGithubTokenSettings();
  }, []);

  React.useEffect(() => {
    registerGitHubAuthUiBridge({
      getState: () => authState,
      runNoticeIntent,
    });

    return () => {
      registerGitHubAuthUiBridge(undefined);
    };
  }, [authState, runNoticeIntent]);

  const value = React.useMemo(
    () => ({
      authState,
      closeAuthDialog,
      consumeReadyAuthAction: (route: string) =>
        consumeReadyAuthAction({
          isSignedIn: Boolean(sessionState.data),
          route,
        }),
      continueAsGuest,
      dialogMode: authStore.dialogMode,
      dialogOpen: authStore.dialogOpen,
      dialogReason: authStore.dialogReason,
      dialogVariant: authStore.dialogVariant,
      ensureRepoAccess: ensureGitHubRepoAccess,
      openAuthDialog,
      openGithubSettings: openGithubTokenSettings,
      runNoticeIntent,
      signIn: signInWithGithub,
      signOut: signOutGithubProductSession,
    }),
    [
      authState,
      authStore.dialogMode,
      authStore.dialogOpen,
      authStore.dialogReason,
      authStore.dialogVariant,
      runNoticeIntent,
      sessionState.data,
    ],
  );

  return <GitHubAuthProvider value={value}>{props.children}</GitHubAuthProvider>;
}
