export const dexieCloudSchema = {
  messages:
    "id, sessionId, [sessionId+order], [sessionId+timestamp], [sessionId+status], order, timestamp, status",
  publicMessages: "id, sessionId, [sessionId+order], order, timestamp",
  publicSessions: "id, publishedAt, updatedAt",
  sessions: "id, updatedAt, createdAt, provider, model, isStreaming",
  shareOwners: "id, ownerUserId, realmId, updatedAt",
} as const;
