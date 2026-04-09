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
 * Clears every persisted store (sessions, messages, settings, provider keys,
 * repositories, daily cost aggregates, runtime metadata). Release active
 * runtime ownership before calling.
 */
export async function deleteAllLocalData(): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.sessions,
      db.messages,
      db.settings,
      db.providerKeys,
      db.repositories,
      db.dailyCosts,
      db.sessionLeases,
      db.sessionRuntime,
    ],
    async () => {
      await db.sessions.clear();
      await db.messages.clear();
      await db.settings.clear();
      await db.providerKeys.clear();
      await db.repositories.clear();
      await db.dailyCosts.clear();
      await db.sessionLeases.clear();
      await db.sessionRuntime.clear();
    },
  );
}
