import type {
  MessageRow,
  PublicMessageRecord,
  PublicSessionRecord,
  SessionData,
} from "@gitinspect/db";

export type PublicSessionSnapshot = {
  messages: PublicMessageRecord[];
  session: PublicSessionRecord;
};

export type SessionShareState = {
  canUnshare: boolean;
  isShared: boolean;
  url: string | null;
};

function sortPublicMessages(messages: PublicMessageRecord[]): PublicMessageRecord[] {
  return [...messages].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }

    return left.id.localeCompare(right.id);
  });
}

export async function loadPublicSessionSnapshot(
  sessionId: string,
): Promise<PublicSessionSnapshot | undefined> {
  const response = await fetch(`/api/shares/${encodeURIComponent(sessionId)}?view=public`);
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Failed to load shared session (${response.status})`);
  const snapshot = (await response.json()) as PublicSessionSnapshot;
  return { ...snapshot, messages: sortPublicMessages(snapshot.messages) };
}

export async function getSessionShareState(sessionId: string): Promise<SessionShareState> {
  const response = await fetch(`/api/shares/${encodeURIComponent(sessionId)}`, {
    credentials: "same-origin",
  });

  if (!response.ok) {
    throw new Error(`Failed to load share state (${response.status})`);
  }

  return (await response.json()) as SessionShareState;
}

export async function publishSessionShare(input: {
  messages: MessageRow[];
  session: SessionData;
}): Promise<SessionShareState> {
  const response = await fetch(`/api/shares/${encodeURIComponent(input.session.id)}`, {
    body: JSON.stringify(input),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error(`Failed to publish share (${response.status})`);
  }

  const result = (await response.json()) as { ok: boolean; url: string };
  return {
    canUnshare: true,
    isShared: result.ok,
    url: result.url,
  };
}

export async function unshareSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/shares/${encodeURIComponent(sessionId)}`, {
    credentials: "same-origin",
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(`Failed to unshare session (${response.status})`);
  }
}
