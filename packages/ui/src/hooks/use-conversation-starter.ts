import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { event as trackEvent } from "onedollarstats";
import { toast } from "sonner";
import type { ResolvedRepoSource } from "@gitinspect/db";
import { runtimeClient } from "@gitinspect/pi/agent/runtime-client";
import { getRuntimeCommandErrorMessage } from "@gitinspect/pi/agent/runtime-command-errors";
import {
  createSessionForChat,
  createSessionForRepo,
  persistLastUsedSessionSettings,
} from "@gitinspect/pi/sessions/session-actions";
import { getCanonicalProvider } from "@gitinspect/pi/models/catalog";
import type { ProviderGroupId, ThinkingLevel } from "@gitinspect/pi/types/models";
import type { PendingAuthAction } from "@gitinspect/ui/components/github-auth-context";
import {
  useMessageEntitlementGuard,
  useModelAccessGuard,
} from "@gitinspect/ui/hooks/use-chat-send-guards";

function getCurrentRoute(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  return `${window.location.pathname}${window.location.search}`;
}

export function useConversationStarter() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const settings = typeof search.settings === "string" ? search.settings : undefined;
  const sidebar = search.sidebar === "open" ? "open" : undefined;
  const { ensureMessageEntitlement, refreshMessageEntitlement } = useMessageEntitlementGuard();
  const { requireModelAccess } = useModelAccessGuard();
  const [isStartingSession, setIsStartingSession] = React.useState(false);

  const startNewConversation = React.useCallback(
    async (input: {
      initialPrompt: string;
      model: string;
      providerGroup: ProviderGroupId;
      thinkingLevel: ThinkingLevel;
      repoSource?: ResolvedRepoSource;
      sourceUrl?: string;
      postAuthAction?: PendingAuthAction;
    }) => {
      if (isStartingSession) {
        return undefined;
      }

      if (
        !requireModelAccess({
          postAuthAction: input.postAuthAction ?? {
            content: input.initialPrompt,
            route: getCurrentRoute(),
            type: "send-first-message",
          },
          providerGroup: input.providerGroup,
          variant: "first-message",
        })
      ) {
        return undefined;
      }

      if (!(await ensureMessageEntitlement({ providerGroup: input.providerGroup }))) {
        return undefined;
      }

      setIsStartingSession(true);

      try {
        const base = {
          model: input.model,
          provider: getCanonicalProvider(input.providerGroup),
          providerGroup: input.providerGroup,
          thinkingLevel: input.thinkingLevel,
        };
        const session = input.repoSource
          ? await createSessionForRepo({
              base,
              repoSource: input.repoSource,
              sourceUrl: input.sourceUrl,
            })
          : await createSessionForChat(base);

        await runtimeClient.startInitialTurn(session, input.initialPrompt);
        void trackEvent("Message sent").catch(() => {
          // Analytics must never interfere with chat sends.
        });
        await navigate({
          params: {
            sessionId: session.id,
          },
          search: {
            q: undefined,
            settings,
            sidebar,
          },
          to: "/chat/$sessionId",
        });

        await refreshMessageEntitlement({ providerGroup: input.providerGroup });
        void persistLastUsedSessionSettings(session);
        return session;
      } catch (error) {
        const runtimeError = error instanceof Error ? error : new Error(String(error));
        toast.error(getRuntimeCommandErrorMessage(runtimeError));
        console.error("[gitinspect:runtime] command_failed", {
          message: runtimeError.message,
        });
        return undefined;
      } finally {
        setIsStartingSession(false);
      }
    },
    [
      ensureMessageEntitlement,
      isStartingSession,
      navigate,
      refreshMessageEntitlement,
      requireModelAccess,
      settings,
      sidebar,
    ],
  );

  return {
    isStartingSession,
    startNewConversation,
  };
}
