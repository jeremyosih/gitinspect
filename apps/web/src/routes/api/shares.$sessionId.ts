import type { MessageRow, SessionData } from "@gitinspect/db";
import { auth } from "@gitinspect/auth";
import { createPublicShareSnapshot } from "@gitinspect/runtime/lib/public-share";
import { ShareIdSchema, SharePublishSchema, readShareBody } from "@gitinspect/shared/public-share";
import { createFileRoute } from "@tanstack/react-router";
import { sharingServiceRequest } from "@/lib/sharing-service.server";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });
function shareUrl(request: Request, id: string) {
  return new URL(`/share/${encodeURIComponent(id)}`, request.url).toString();
}
async function currentOwner(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ? (session.user.ghId ?? session.user.id) : undefined;
}
function invalidOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

export const Route = createFileRoute("/api/shares/$sessionId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!ShareIdSchema.safeParse(params.sessionId).success)
          return json({ error: "Invalid session id" }, 400);
        if (new URL(request.url).searchParams.get("view") === "public")
          return sharingServiceRequest({ sessionId: params.sessionId, publicView: true });
        const ownerUserId = await currentOwner(request);
        if (!ownerUserId) return json({ error: "Unauthorized" }, 401);
        const response = await sharingServiceRequest({ sessionId: params.sessionId, ownerUserId });
        if (!response.ok) return response;
        const state = (await response.json()) as { isShared: boolean; canUnshare: boolean };
        return json({ ...state, url: state.isShared ? shareUrl(request, params.sessionId) : null });
      },
      PUT: async ({ params, request }) => {
        if (invalidOrigin(request)) return json({ error: "Forbidden" }, 403);
        const ownerUserId = await currentOwner(request);
        if (!ownerUserId) return json({ error: "Unauthorized" }, 401);
        let payload;
        try {
          payload = SharePublishSchema.parse(JSON.parse(await readShareBody(request)));
        } catch (error) {
          return json(
            { error: error instanceof RangeError ? error.message : "Invalid share payload" },
            error instanceof RangeError ? 413 : 400,
          );
        }
        if (
          payload.session.id !== params.sessionId ||
          payload.messages.some(
            (message) => "sessionId" in message && message.sessionId !== params.sessionId,
          )
        )
          return json({ error: "Session id mismatch" }, 400);
        const now = new Date().toISOString();
        const snapshot = createPublicShareSnapshot({
          messages: payload.messages as MessageRow[],
          session: payload.session as SessionData,
          publishedAt: now,
          updatedAt: now,
        });
        const response = await sharingServiceRequest({
          sessionId: params.sessionId,
          ownerUserId,
          method: "PUT",
          body: JSON.stringify(snapshot),
        });
        if (!response.ok) return response;
        return json({ ok: true, url: shareUrl(request, params.sessionId) });
      },
      DELETE: async ({ params, request }) => {
        if (invalidOrigin(request)) return json({ error: "Forbidden" }, 403);
        if (!ShareIdSchema.safeParse(params.sessionId).success)
          return json({ error: "Invalid session id" }, 400);
        const ownerUserId = await currentOwner(request);
        if (!ownerUserId) return json({ error: "Unauthorized" }, 401);
        return sharingServiceRequest({
          sessionId: params.sessionId,
          ownerUserId,
          method: "DELETE",
        });
      },
    },
  },
});
