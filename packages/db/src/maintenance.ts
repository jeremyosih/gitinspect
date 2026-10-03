import { db } from "./db";
import { getSessionMessages, listSessions } from "./sessions";
import type { MessageRow, SessionData } from "./types";

export type ChatDataExportV1 = {
  exportVersion: 1;
  exportedAt: string;
  sessions: Array<{
    messages: MessageRow[];
    session: SessionData;
  }>;
};

export async function exportAllChatData(): Promise<ChatDataExportV1> {
  const sessions = await listSessions();
  const sessionsWithMessages = await Promise.all(
    sessions.map(async (session) => ({
      messages: await getSessionMessages(session.id),
      session,
    })),
  );

  return {
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    sessions: sessionsWithMessages,
  };
}

/**
 * Wipes this browser's IndexedDB for this app without affecting published shares.
 * Release active runtime ownership and sign the user out before calling.
 */
export async function deleteAllLocalData(): Promise<void> {
  await db.delete();
  await db.open();
}
