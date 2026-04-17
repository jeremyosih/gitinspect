"use client";

import * as React from "react";
import type { MessageRow, SessionData } from "@gitinspect/db";
import { publishSessionShare } from "@gitinspect/pi/lib/public-share-client";

const DEBOUNCE_MS = 3_000;

/**
 * While a session is shared, debounce-republishes the public snapshot when the
 * transcript message count increases (manual initial publish is assumed to match).
 */
export function useAutoRepublish(
  isShared: boolean,
  session: SessionData | undefined,
  transcriptMessages: MessageRow[] | undefined,
): void {
  const lastPublishedCountRef = React.useRef<number | null>(null);
  const transcriptRef = React.useRef(transcriptMessages);
  transcriptRef.current = transcriptMessages;
  const sessionRef = React.useRef(session);
  sessionRef.current = session;

  const transcriptLength = transcriptMessages?.length ?? 0;
  const lastMessageId = transcriptMessages?.at(-1)?.id;

  React.useEffect(() => {
    if (!isShared) {
      lastPublishedCountRef.current = null;
      return;
    }

    const currentSession = sessionRef.current;
    const messages = transcriptRef.current;

    if (!currentSession || !messages) {
      return;
    }

    if (lastPublishedCountRef.current === null) {
      lastPublishedCountRef.current = messages.length;
      return;
    }

    if (messages.length === lastPublishedCountRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const latestSession = sessionRef.current;
          const latestMessages = transcriptRef.current;
          if (!latestSession || !latestMessages) {
            return;
          }

          await publishSessionShare({
            messages: latestMessages,
            session: latestSession,
          });
          lastPublishedCountRef.current = latestMessages.length;
        } catch (error) {
          console.warn("[share] auto-republish failed", error);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isShared, transcriptLength, lastMessageId]);
}
