import * as React from "react";
import { useCustomer } from "autumn-js/react";
import { toast } from "sonner";
import {
  type AuthDialogVariant,
  type PendingAuthAction,
  useGitHubAuthContext,
} from "@gitinspect/ui/components/github-auth-context";
import type { ProviderGroupId } from "@gitinspect/pi/types/models";

const AUTUMN_MESSAGES_FEATURE_ID = "messages";

function isGitinspectProviderGroup(providerGroup: ProviderGroupId): boolean {
  return providerGroup === "fireworks-free";
}

export function useModelAccessGuard() {
  const auth = useGitHubAuthContext();

  const requireModelAccess = React.useCallback(
    (input: {
      postAuthAction?: PendingAuthAction;
      providerGroup: ProviderGroupId;
      variant?: AuthDialogVariant;
    }): boolean => {
      if (!auth) {
        return true;
      }

      if (
        auth.authState.session === "signed-out" &&
        isGitinspectProviderGroup(input.providerGroup)
      ) {
        auth.openAuthDialog({
          mode: input.variant === "first-message" ? "full" : "github-only",
          postAuthAction: input.postAuthAction,
          reason: "free-models",
          variant: input.variant,
        });
        return false;
      }

      return true;
    },
    [auth],
  );

  return {
    requireModelAccess,
  };
}

export function useMessageEntitlementGuard() {
  const auth = useGitHubAuthContext();
  const autumnCustomer = useCustomer({
    queryOptions: {
      enabled: auth?.authState.session === "signed-in",
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
    },
  });

  const ensureMessageEntitlement = React.useCallback(async () => {
    if (auth?.authState.session !== "signed-in") {
      return true;
    }

    if (autumnCustomer.error) {
      toast.error(autumnCustomer.error.message);
      return false;
    }

    if (autumnCustomer.isLoading || !autumnCustomer.data) {
      toast.error("Checking your subscription...");
      return false;
    }

    const { allowed } = autumnCustomer.check({
      featureId: AUTUMN_MESSAGES_FEATURE_ID,
    });

    if (!allowed) {
      toast.error("You're out of messages");
      return false;
    }

    return true;
  }, [auth?.authState.session, autumnCustomer]);

  const refreshMessageEntitlement = React.useCallback(async () => {
    if (auth?.authState.session !== "signed-in") {
      return;
    }

    await autumnCustomer.refetch();
  }, [auth?.authState.session, autumnCustomer]);

  return {
    ensureMessageEntitlement,
    refreshMessageEntitlement,
  };
}
