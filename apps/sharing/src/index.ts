import { DurableObject } from "cloudflare:workers";
import { PublicShareSchema, ShareIdSchema, readShareBody } from "@gitinspect/shared/public-share";

export interface SharingEnv {
  SHARES: DurableObjectNamespace<ShareDO>;
  SHARING_SERVICE_SECRET: string;
}
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "cache-control": "no-store" } });

/** One SQLite-backed object per share; owner survives unpublish to prevent takeover. */
export class ShareDO extends DurableObject<SharingEnv> {
  constructor(ctx: DurableObjectState, env: SharingEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS share (id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, snapshot TEXT, published_at TEXT NOT NULL)",
    );
  }
  async fetch(request: Request): Promise<Response> {
    const publicView = new URL(request.url).pathname.startsWith("/public/");
    if (publicView && request.method === "GET") {
      const row = this.ctx.storage.sql
        .exec<{ snapshot: string | null }>("SELECT snapshot FROM share WHERE id = 1")
        .toArray()[0];
      return row?.snapshot
        ? new Response(row.snapshot, {
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          })
        : json({ error: "Share not found" }, 404);
    }
    const owner = request.headers.get("x-share-owner");
    if (!owner) return json({ error: "Unauthorized" }, 401);
    if (request.method === "PUT") {
      let snapshot;
      try {
        snapshot = PublicShareSchema.parse(JSON.parse(await readShareBody(request)));
      } catch (error) {
        return json(
          { error: error instanceof RangeError ? error.message : "Invalid share snapshot" },
          error instanceof RangeError ? 413 : 400,
        );
      }
      const id = new URL(request.url).pathname.split("/").at(-1);
      if (
        snapshot.session.id !== id ||
        snapshot.messages.some(
          (message) => message.sessionId !== id || message.status === "streaming",
        )
      )
        return json({ error: "Share session mismatch" }, 400);
      // There are no awaits between checking ownership and committing the replacement.
      return this.ctx.storage.transactionSync(() => {
        const row = this.ctx.storage.sql
          .exec<{ owner: string; published_at: string }>(
            "SELECT owner, published_at FROM share WHERE id = 1",
          )
          .toArray()[0];
        if (row && row.owner !== owner) return json({ error: "Forbidden" }, 403);
        const publishedAt = row?.published_at ?? new Date().toISOString();
        snapshot.session.publishedAt = publishedAt;
        snapshot.session.updatedAt = new Date().toISOString();
        this.ctx.storage.sql.exec(
          "INSERT INTO share (id, owner, snapshot, published_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot",
          owner,
          JSON.stringify(snapshot),
          publishedAt,
        );
        return json({ ok: true });
      });
    }
    const row = this.ctx.storage.sql
      .exec<{ owner: string; snapshot: string | null }>(
        "SELECT owner, snapshot FROM share WHERE id = 1",
      )
      .toArray()[0];
    if (row && row.owner !== owner) return json({ error: "Forbidden" }, 403);
    if (request.method === "GET")
      return json({ isShared: Boolean(row?.snapshot), canUnshare: Boolean(row?.snapshot) });
    if (request.method === "DELETE") {
      this.ctx.storage.sql.exec("UPDATE share SET snapshot = NULL WHERE id = 1");
      return json({ ok: true });
    }
    return json({ error: "Method not allowed" }, 405);
  }
}

export default {
  async fetch(request: Request, env: SharingEnv): Promise<Response> {
    const match = /^\/(public\/)?shares\/([^/]+)$/.exec(new URL(request.url).pathname);
    const id = ShareIdSchema.safeParse(match?.[2]);
    if (!match || !id.success) return json({ error: "Not found" }, 404);
    const publicView = Boolean(match[1]);
    if (publicView && request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    if (
      !publicView &&
      (!env.SHARING_SERVICE_SECRET ||
        request.headers.get("authorization") !== `Bearer ${env.SHARING_SERVICE_SECRET}`)
    )
      return json({ error: "Unauthorized" }, 401);
    const headers = new Headers(request.headers);
    if (publicView) headers.delete("x-share-owner");
    else if (!headers.get("x-share-owner") || headers.get("x-share-owner")!.length > 256)
      return json({ error: "Unauthorized" }, 401);
    const object = env.SHARES.get(env.SHARES.idFromName(id.data));
    return object.fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<SharingEnv>;
