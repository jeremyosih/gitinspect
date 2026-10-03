import { useLiveQuery } from "dexie-react-hooks";
import { loadSession } from "@gitinspect/runtime/sessions/session-service";

export function useSelectedSessionSummary(sessionId: string | undefined) {
  return useLiveQuery(async () => {
    if (!sessionId) {
      return undefined;
    }

    return await loadSession(sessionId);
  }, [sessionId]);
}
