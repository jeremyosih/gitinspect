import type { PublicMessageRecord, PublicSessionRecord } from "@gitinspect/db";
import type { MessageRow, SessionData } from "@gitinspect/db";

export function toPublicSessionRecord(input: {
  messageIds: string[];
  publishedAt?: string;
  session: SessionData;
  sessionId: string;
}): PublicSessionRecord {
  return {
    createdAt: input.session.createdAt,
    id: input.sessionId,
    messageCount: input.session.messageCount,
    messageIds: input.messageIds,
    preview: input.session.preview,
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    realmId: "rlm-public",
    repoSource: input.session.repoSource
      ? {
          owner: input.session.repoSource.owner,
          ref: input.session.repoSource.ref,
          refOrigin: input.session.repoSource.refOrigin,
          repo: input.session.repoSource.repo,
          resolvedRef: input.session.repoSource.resolvedRef,
        }
      : undefined,
    sourceUrl: input.session.sourceUrl,
    title: input.session.title,
    updatedAt: input.session.updatedAt,
    version: 1,
  };
}

export function toPublicMessageRecords(
  sessionId: string,
  messages: MessageRow[],
): PublicMessageRecord[] {
  return messages
    .filter((message) => message.role !== "system")
    .filter((message) => message.status !== "streaming")
    .map((message) => ({
      id: `${sessionId}:${message.id}`,
      order: message.order,
      realmId: "rlm-public",
      sessionId,
      timestamp: message.timestamp,
      value: { ...message },
    }));
}
