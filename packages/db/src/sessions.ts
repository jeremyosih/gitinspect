import Dexie from "dexie";
import { db } from "./db";
import type { MessageRow, SessionData, SessionLeaseRow, SessionRuntimeRow } from "./types";

export async function putSession(session: SessionData): Promise<void> {
  await db.sessions.put(session);
}

export async function putMessage(message: MessageRow): Promise<void> {
  await db.messages.put(message);
}

export async function putMessages(messages: MessageRow[]): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  await db.messages.bulkPut(messages);
}

export async function putSessionAndMessages(
  session: SessionData,
  messages: MessageRow[],
): Promise<void> {
  await db.transaction("rw", db.sessions, db.messages, async () => {
    await db.sessions.put(session);
    await putMessages(messages);
  });
}

export async function replaceSessionMessages(
  session: SessionData,
  messages: MessageRow[],
): Promise<void> {
  await db.transaction("rw", db.sessions, db.messages, async () => {
    const existingMessages = await db.messages.where("sessionId").equals(session.id).toArray();
    const nextMessageIds = new Set(messages.map((message) => message.id));
    const deletedMessageIds = existingMessages
      .filter((message) => !nextMessageIds.has(message.id))
      .map((message) => message.id);

    await db.sessions.put(session);

    if (deletedMessageIds.length > 0) {
      await db.messages.bulkDelete(deletedMessageIds);
    }

    if (messages.length > 0) {
      await db.messages.bulkPut(messages);
    }
  });
}

export async function getSession(id: string): Promise<SessionData | undefined> {
  return await db.sessions.get(id);
}

export async function getSessionMessages(sessionId: string): Promise<MessageRow[]> {
  return await db.messages
    .where("[sessionId+order]")
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .sortBy("order");
}

export async function listSessions(): Promise<SessionData[]> {
  return await db.sessions.orderBy("updatedAt").reverse().toArray();
}

export async function getLatestSessionId(): Promise<string | undefined> {
  return (await db.sessions.orderBy("updatedAt").reverse().first())?.id;
}

export async function getMostRecentSession(): Promise<SessionData | undefined> {
  const latestId = await getLatestSessionId();

  if (!latestId) {
    return undefined;
  }

  return await getSession(latestId);
}

export async function deleteMessagesBySession(sessionId: string): Promise<void> {
  const messageIds = await db.messages.where("sessionId").equals(sessionId).primaryKeys();

  await db.messages.bulkDelete(messageIds);
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction(
    "rw",
    db.sessions,
    db.messages,
    db.sessionLeases,
    db.sessionRuntime,
    async () => {
      await db.sessions.delete(id);
      await deleteMessagesBySession(id);
      await db.sessionLeases.delete(id);
      await db.sessionRuntime.delete(id);
    },
  );
}

export async function getSessionLease(sessionId: string): Promise<SessionLeaseRow | undefined> {
  return await db.sessionLeases.get(sessionId);
}

export async function putSessionLease(row: SessionLeaseRow): Promise<void> {
  await db.sessionLeases.put(row);
}

export async function deleteSessionLease(sessionId: string): Promise<void> {
  await db.sessionLeases.delete(sessionId);
}

export async function listSessionLeases(): Promise<SessionLeaseRow[]> {
  return await db.sessionLeases.toArray();
}

export async function getSessionRuntime(sessionId: string): Promise<SessionRuntimeRow | undefined> {
  return await db.sessionRuntime.get(sessionId);
}

export async function putSessionRuntime(row: SessionRuntimeRow): Promise<void> {
  await db.sessionRuntime.put(row);
}

export async function deleteSessionRuntime(sessionId: string): Promise<void> {
  await db.sessionRuntime.delete(sessionId);
}

export async function runConversationTransaction<T>(callback: () => Promise<T>): Promise<T> {
  return await db.transaction("rw", db.sessions, db.messages, db.sessionRuntime, callback);
}
