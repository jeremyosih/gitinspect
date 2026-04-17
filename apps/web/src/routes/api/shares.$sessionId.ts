import type {
  MessageRow,
  PublicMessageRecord,
  PublicSessionRecord,
  SessionData,
  SyncedSessionRow,
} from "@gitinspect/db";
import { auth } from "@gitinspect/auth";
import { env } from "@gitinspect/env/server";
import { createPublicShareSnapshot } from "@gitinspect/pi/lib/public-share";
import { createFileRoute } from "@tanstack/react-router";
import { getCanonicalAppUserId, isShareEntitledForUser } from "@/lib/autumn.server";
import {
  DexieCloudSchemaPendingError,
  deleteDexieCloudRecord,
  getDexieCloudRecord,
  listDexieCloudRecords,
  putDexieCloudRecord,
} from "@/lib/dexie-cloud-rest.server";

type SharePublishPayload = {
  messages: MessageRow[];
  session: SessionData;
};

function isDexieCloudConfigured(): boolean {
  return Boolean(
    env.DEXIE_CLOUD_DB_URL && env.DEXIE_CLOUD_CLIENT_ID && env.DEXIE_CLOUD_CLIENT_SECRET,
  );
}

function buildPublicShareUrl(request: Request, sessionId: string): string {
  return new URL(`/share/${encodeURIComponent(sessionId)}`, request.url).toString();
}

export const Route = createFileRoute("/api/shares/$sessionId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!isDexieCloudConfigured()) {
          return Response.json({ error: "Dexie Cloud is not configured" }, { status: 503 });
        }

        const session = await auth.api.getSession({
          headers: request.headers,
        });

        if (!session?.user) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const publicSession = await getDexieCloudRecord<PublicSessionRecord>(
          `/public/publicSessions/${params.sessionId}`,
        );
        const currentUserId = getCanonicalAppUserId(session.user);
        const isShared = publicSession?.ownerUserId === currentUserId;

        return Response.json({
          canUnshare: isShared,
          isShared,
          url: isShared ? buildPublicShareUrl(request, params.sessionId) : null,
        });
      },
      PUT: async ({ params, request }) => {
        if (!isDexieCloudConfigured()) {
          return Response.json({ error: "Dexie Cloud is not configured" }, { status: 503 });
        }

        const session = await auth.api.getSession({
          headers: request.headers,
        });

        if (!session?.user) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (!(await isShareEntitledForUser(session.user))) {
          return Response.json(
            { error: "Sharing is not enabled for this account" },
            { status: 403 },
          );
        }

        const payload = (await request.json()) as SharePublishPayload;

        if (payload.session.id !== params.sessionId) {
          return Response.json({ error: "Session id mismatch" }, { status: 400 });
        }

        if (payload.messages.some((message) => message.sessionId !== params.sessionId)) {
          return Response.json({ error: "Message session mismatch" }, { status: 400 });
        }

        const currentUserId = getCanonicalAppUserId(session.user);

        try {
          const syncedSession = await getDexieCloudRecord<SyncedSessionRow>(
            `/all/sessions/${params.sessionId}`,
          );

          if (syncedSession && syncedSession.owner !== currentUserId) {
            return Response.json({ error: "Forbidden" }, { status: 403 });
          }

          const existingPublic = await getDexieCloudRecord<PublicSessionRecord>(
            `/public/publicSessions/${params.sessionId}`,
          );

          if (existingPublic && existingPublic.ownerUserId !== currentUserId) {
            return Response.json({ error: "Forbidden" }, { status: 403 });
          }

          const now = new Date().toISOString();
          const publishedAt = existingPublic?.publishedAt ?? now;
          const snapshot = createPublicShareSnapshot({
            messages: payload.messages,
            ownerUserId: currentUserId,
            publishedAt,
            session: payload.session,
            updatedAt: now,
          });

          const existingMessages = await listDexieCloudRecords<PublicMessageRecord>(
            `/public/publicMessages?sessionId=${encodeURIComponent(params.sessionId)}`,
          );

          await Promise.all(
            existingMessages.map((message) =>
              deleteDexieCloudRecord(`/public/publicMessages/${message.id}`),
            ),
          );

          await putDexieCloudRecord(`/public/publicSessions`, snapshot.session);
          await Promise.all(
            snapshot.messages.map((message) =>
              putDexieCloudRecord(`/public/publicMessages`, message),
            ),
          );

          return Response.json({
            ok: true,
            url: buildPublicShareUrl(request, params.sessionId),
          });
        } catch (error) {
          if (error instanceof DexieCloudSchemaPendingError) {
            return Response.json({ error: error.message }, { status: 503 });
          }
          throw error;
        }
      },
      DELETE: async ({ params, request }) => {
        if (!isDexieCloudConfigured()) {
          return Response.json({ error: "Dexie Cloud is not configured" }, { status: 503 });
        }

        const session = await auth.api.getSession({
          headers: request.headers,
        });

        if (!session?.user) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const publicSession = await getDexieCloudRecord<PublicSessionRecord>(
          `/public/publicSessions/${params.sessionId}`,
        );
        const currentUserId = getCanonicalAppUserId(session.user);

        if (!publicSession) {
          return Response.json({ ok: true });
        }

        if (publicSession.ownerUserId !== currentUserId) {
          return Response.json({ error: "Forbidden" }, { status: 403 });
        }

        const existingMessages = await listDexieCloudRecords<PublicMessageRecord>(
          `/public/publicMessages?sessionId=${encodeURIComponent(params.sessionId)}`,
        );

        await Promise.all(
          existingMessages.map((message) =>
            deleteDexieCloudRecord(`/public/publicMessages/${message.id}`),
          ),
        );
        await deleteDexieCloudRecord(`/public/publicSessions/${params.sessionId}`);

        return Response.json({ ok: true });
      },
    },
  },
});
