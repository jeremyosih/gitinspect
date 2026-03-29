import { getCurrentTabId } from "@/agent/tab-id"
import { db, deleteSessionLease, getSessionLease } from "@/db/schema"
import { getIsoNow } from "@/lib/dates"
import { createId } from "@/lib/ids"
import type { SessionLeaseRow } from "@/types/storage"

export const LEASE_HEARTBEAT_MS = 5_000
export const LEASE_STALE_MS = 20_000

export type SessionLeaseState =
  | { kind: "locked"; lease: SessionLeaseRow }
  | { kind: "none" }
  | { kind: "owned"; lease: SessionLeaseRow }
  | { kind: "stale"; lease: SessionLeaseRow }

export type LeaseClaimResult =
  | { kind: "locked"; lease: SessionLeaseRow }
  | { kind: "owned"; lease: SessionLeaseRow }

function toTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function isSessionLeaseStale(
  lease: SessionLeaseRow,
  now = Date.now()
): boolean {
  return now - toTimestamp(lease.heartbeatAt) >= LEASE_STALE_MS
}

export async function loadSessionLeaseState(
  sessionId: string
): Promise<SessionLeaseState> {
  const lease = await getSessionLease(sessionId)

  if (!lease) {
    return { kind: "none" }
  }

  if (lease.ownerTabId === getCurrentTabId()) {
    return { kind: "owned", lease }
  }

  if (isSessionLeaseStale(lease)) {
    return { kind: "stale", lease }
  }

  return { kind: "locked", lease }
}

export async function claimSessionLease(
  sessionId: string
): Promise<LeaseClaimResult> {
  const ownerTabId = getCurrentTabId()
  const ownerToken = createId()
  const now = getIsoNow()

  await db.transaction("rw", db.sessionLeases, async () => {
    const current = await db.sessionLeases.get(sessionId)

    if (
      current &&
      current.ownerTabId !== ownerTabId &&
      !isSessionLeaseStale(current)
    ) {
      return
    }

    await db.sessionLeases.put({
      acquiredAt: current?.acquiredAt ?? now,
      heartbeatAt: now,
      ownerTabId,
      ownerToken,
      sessionId,
    })
  })

  const lease = await getSessionLease(sessionId)

  if (!lease) {
    throw new Error(`Failed to persist session lease for ${sessionId}`)
  }

  if (lease.ownerTabId === ownerTabId && lease.ownerToken === ownerToken) {
    return { kind: "owned", lease }
  }

  return { kind: "locked", lease }
}

export async function renewSessionLease(
  sessionId: string
): Promise<SessionLeaseRow | undefined> {
  const ownerTabId = getCurrentTabId()
  const current = await getSessionLease(sessionId)

  if (!current || current.ownerTabId !== ownerTabId) {
    return undefined
  }

  const next: SessionLeaseRow = {
    ...current,
    heartbeatAt: getIsoNow(),
  }

  await db.sessionLeases.put(next)
  return next
}

export async function releaseSessionLease(sessionId: string): Promise<void> {
  const current = await getSessionLease(sessionId)

  if (!current || current.ownerTabId !== getCurrentTabId()) {
    return
  }

  await deleteSessionLease(sessionId)
}

export async function releaseOwnedSessionLeases(): Promise<void> {
  const ownerTabId = getCurrentTabId()
  const leases = await db.sessionLeases
    .where("ownerTabId")
    .equals(ownerTabId)
    .toArray()

  if (leases.length === 0) {
    return
  }

  await db.sessionLeases.bulkDelete(leases.map((lease) => lease.sessionId))
}
