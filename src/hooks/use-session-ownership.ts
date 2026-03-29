import { useLiveQuery } from "dexie-react-hooks"
import { loadSessionLeaseState } from "@/db/session-leases"

export function useSessionOwnership(sessionId: string | undefined) {
  const leaseState = useLiveQuery(
    async () =>
      sessionId ? await loadSessionLeaseState(sessionId) : { kind: "none" as const },
    [sessionId]
  )

  return leaseState ?? { kind: "none" as const }
}
