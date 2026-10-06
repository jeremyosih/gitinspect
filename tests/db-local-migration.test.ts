import Dexie from "dexie";
import { it, expect } from "vitest";
import { AppDb } from "@gitinspect/db";

it("migrates an addon-era database without losing chats or credentials", async () => {
  const name = `gitinspect-cloud-to-local-${crypto.randomUUID()}`;
  const old = new Dexie(name);
  old.version(10.1).stores({
    sessions: "id",
    messages: "id, sessionId",
    "provider-keys": "provider",
    fx_checkpoints: "sessionId",
    publicSessions: "id",
    $realms: "realmId",
  });
  await old.open();
  await old
    .table("sessions")
    .put({ id: "session-1", title: "Keep this", owner: "old-user", realmId: "old-realm" });
  await old.table("messages").put({
    id: "m1",
    sessionId: "session-1",
    role: "user",
    content: "Keep my transcript",
    owner: "old-user",
    realmId: "old-realm",
  });
  await old.table("provider-keys").put({ provider: "openai", value: "fixture-key" });
  await old.table("fx_checkpoints").put({ sessionId: "session-1", bytes: new Uint8Array([1, 2]) });
  old.close();
  const migrated = new AppDb(name);
  try {
    await migrated.open();
    expect(migrated.verno).toBe(12);
    expect(await migrated.sessions.get("session-1")).toEqual({
      id: "session-1",
      title: "Keep this",
    });
    expect((await migrated.messages.get("m1"))?.content).toBe("Keep my transcript");
    expect((await migrated.providerKeys.get("openai"))?.value).toBe("fixture-key");
    expect(migrated.tables.map((table) => table.name)).not.toContain("publicSessions");
    expect(migrated.tables.map((table) => table.name)).not.toContain("fx_checkpoints");
  } finally {
    migrated.close();
    await Dexie.delete(name);
  }
});
