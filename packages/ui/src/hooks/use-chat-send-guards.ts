import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { db } from "@gitinspect/db";
import { getCanonicalProvider, getConnectedProviders } from "@gitinspect/runtime/models/catalog";
import type { ProviderGroupId } from "@gitinspect/runtime/types/models";
import type {
  AuthDialogVariant,
  PendingAuthAction,
} from "@gitinspect/ui/components/github-auth-context";

export function useModelAccessGuard() {
  const navigate = useNavigate();
  const requireModelAccess = React.useCallback(
    async (input: {
      providerGroup: ProviderGroupId;
      postAuthAction?: PendingAuthAction;
      variant?: AuthDialogVariant;
    }) => {
      const provider = getCanonicalProvider(input.providerGroup);
      const keys = await db.providerKeys.toArray();
      if (getConnectedProviders(keys).includes(provider)) return true;
      toast.error("Connect an API key or subscription in Providers to start chatting.");
      void navigate({ to: ".", search: (previous) => ({ ...previous, settings: "providers" }) });
      return false;
    },
    [navigate],
  );
  return { requireModelAccess };
}
