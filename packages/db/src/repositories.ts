import { getIsoNow } from "@gitinspect/pi/lib/dates";
import { db } from "./db";
import type { RepositoryRow } from "./types";

export async function touchRepository(
  source: Pick<RepositoryRow, "owner" | "ref" | "refOrigin" | "repo">,
): Promise<void> {
  const owner = source.owner.trim();
  const repo = source.repo.trim();
  const ref = source.ref.trim();

  if (!owner || !repo || !ref) {
    return;
  }

  await db.repositories.put({
    lastOpenedAt: getIsoNow(),
    owner,
    ref,
    refOrigin: source.refOrigin,
    repo,
  });
}

export async function listRepositories(): Promise<RepositoryRow[]> {
  return await db.repositories.orderBy("lastOpenedAt").reverse().toArray();
}
