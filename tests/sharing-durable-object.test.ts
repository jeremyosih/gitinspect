// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Miniflare } from "miniflare";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const secret = "fixture-sharing-secret-at-least-32-characters";
const directory = mkdtempSync(join(tmpdir(), "gitinspect-sharing-"));
let mf: Miniflare;
const create = () =>
  new Miniflare({
    modules: true,
    scriptPath: "apps/sharing/dist/index.js",
    compatibilityDate: "2026-07-30",
    durableObjects: { SHARES: { className: "ShareDO", useSQLite: true } },
    durableObjectsPersist: directory,
    bindings: { SHARING_SERVICE_SECRET: secret },
  });
const snapshot = () => ({
  session: {
    id: "session-1",
    title: "Shared chat",
    createdAt: "2026-10-03",
    updatedAt: "2026-10-03",
    publishedAt: "2026-10-03",
    secret: "must-strip",
  },
  messages: [
    {
      id: "user-1",
      role: "user",
      content: "Hello",
      sessionId: "session-1",
      timestamp: 1,
      order: 0,
      status: "completed",
      apiKey: "must-strip",
    },
  ],
});
const request = (method: string, owner = "gh_alice", body?: unknown, authorized = true) =>
  mf.dispatchFetch("http://service/shares/session-1", {
    method,
    headers: {
      authorization: authorized ? `Bearer ${secret}` : "Bearer wrong",
      "x-share-owner": owner,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
beforeAll(() => {
  execFileSync("bun", ["run", "--cwd", "apps/sharing", "build"], { stdio: "pipe" });
  mf = create();
});
afterAll(async () => {
  await mf.dispose();
  rmSync(directory, { recursive: true, force: true });
});

describe("SQLite sharing Durable Object", () => {
  it("publishes, restores persisted state, prevents takeover, and unpublishes atomically", async () => {
    expect((await request("PUT", "gh_alice", snapshot(), false)).status).toBe(401);
    expect((await mf.dispatchFetch("http://service/public/shares/session-1")).status).toBe(404);
    expect((await request("PUT", "gh_alice", snapshot())).status).toBe(200);
    const published = (await (
      await mf.dispatchFetch("http://service/public/shares/session-1")
    ).json()) as any;
    expect(published.messages).toHaveLength(1);
    expect(published.session).not.toHaveProperty("secret");
    expect(published.session).not.toHaveProperty("owner");
    expect(published.messages[0]).not.toHaveProperty("apiKey");
    await mf.dispose();
    mf = create();
    expect(
      ((await (await mf.dispatchFetch("http://service/public/shares/session-1")).json()) as any)
        .messages[0].content,
    ).toBe("Hello");
    expect((await request("PUT", "gh_bob", snapshot())).status).toBe(403);
    expect((await request("DELETE", "gh_bob")).status).toBe(403);
    expect((await request("DELETE")).status).toBe(200);
    expect((await mf.dispatchFetch("http://service/public/shares/session-1")).status).toBe(404);
    expect((await request("PUT", "gh_bob", snapshot())).status).toBe(403);
    expect((await request("PUT", "gh_alice", snapshot())).status).toBe(200);
    const republished = (await (
      await mf.dispatchFetch("http://service/public/shares/session-1")
    ).json()) as any;
    expect(republished.session.publishedAt).toBe(published.session.publishedAt);
  }, 30000);
  it("rejects invalid, mismatched, streaming, oversized, and public-write requests", async () => {
    expect((await request("PUT", "gh_alice", {})).status).toBe(400);
    const mixed = snapshot();
    mixed.messages[0]!.sessionId = "session-2";
    expect((await request("PUT", "gh_alice", mixed)).status).toBe(400);
    const streaming = snapshot();
    streaming.messages[0]!.status = "streaming";
    expect((await request("PUT", "gh_alice", streaming)).status).toBe(400);
    expect(
      (await request("PUT", "gh_alice", { padding: "x".repeat(2 * 1024 * 1024) })).status,
    ).toBe(413);
    expect(
      (await mf.dispatchFetch("http://service/public/shares/session-1", { method: "DELETE" }))
        .status,
    ).toBe(405);
  });
});
