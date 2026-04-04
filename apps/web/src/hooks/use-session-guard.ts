import * as React from "react";
import { authClient } from "@/lib/auth-client";
import { openAuthDialog } from "@/store/auth-store";
import type {
  AuthDialogMode,
  AuthDialogVariant,
  PendingAuthAction,
} from "@gitinspect/ui/components/github-auth-context";

export function useSessionGuard() {
  const sessionState = authClient.useSession();

  const requireSession = React.useCallback(
    (input?: {
      mode?: AuthDialogMode;
      postAuthAction?: PendingAuthAction;
      variant?: AuthDialogVariant;
    }): boolean => {
      if (sessionState.data) {
        return true;
      }

      openAuthDialog({
        mode: input?.mode ?? "full",
        postAuthAction: input?.postAuthAction,
        variant: input?.variant ?? "default",
      });
      return false;
    },
    [sessionState.data],
  );

  return {
    requireSession,
    session: sessionState.data,
  };
}
