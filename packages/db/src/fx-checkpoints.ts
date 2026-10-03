import { db } from "./db";
import type { MessageRow, ResolvedRepoSource } from "./types";
export interface FxCheckpointRow {
  sessionId: string;
  engineVersion: "0.0.12";
  bytes: Uint8Array;
  transcriptHash: string;
  repoCommitSha?: string;
  repoIdentity?: string;
  updatedAt: string;
}
export async function transcriptHash(messages: readonly MessageRow[]): Promise<string> {
  const data = JSON.stringify(
    messages
      .filter((row) => row.role !== "system")
      .map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        ...(row.role === "toolResult" ? { toolCallId: row.toolCallId, isError: row.isError } : {}),
      })),
  );
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function checkpointRepoIdentity(source: ResolvedRepoSource | undefined): string | undefined {
  return source
    ? JSON.stringify({ owner: source.owner, repo: source.repo, ref: source.resolvedRef })
    : undefined;
}
export async function loadFxCheckpoint(
  sessionId: string,
  messages: readonly MessageRow[],
  source?: ResolvedRepoSource,
): Promise<FxCheckpointRow | undefined> {
  const row = await db.fxCheckpoints.get(sessionId);
  return row?.engineVersion === "0.0.12" &&
    row.repoIdentity === checkpointRepoIdentity(source) &&
    row.transcriptHash === (await transcriptHash(messages))
    ? row
    : undefined;
}
