// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
const envState = {
  SHARING_SERVICE_URL: "",
  SHARING_SERVICE_SECRET: "fixture-sharing-secret-at-least-32-characters",
};
vi.mock("@gitinspect/env/server", () => ({ env: envState }));

describe("sharing service bridge", () => {
  it("forwards decoded upstream responses and keeps service credentials off public reads", async () => {
    const requests: Array<{ url?: string; authorization?: string; owner?: string }> = [];
    const encoded = gzipSync(JSON.stringify({ ok: true }));
    const server = createServer((request, response) => {
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
        owner: request.headers["x-share-owner"] as string | undefined,
      });
      response.writeHead(200, {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": encoded.length,
      });
      response.end(encoded);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server address");
    envState.SHARING_SERVICE_URL = `http://127.0.0.1:${address.port}`;
    try {
      const { sharingServiceRequest } = await import("@/lib/sharing-service.server");
      const publicRead = await sharingServiceRequest({ sessionId: "session-1", publicView: true });
      expect(publicRead.headers.has("content-encoding")).toBe(false);
      expect(publicRead.headers.has("content-length")).toBe(false);
      expect(await publicRead.json()).toEqual({ ok: true });
      const privateRead = await sharingServiceRequest({
        sessionId: "session-1",
        ownerUserId: "fixture-owner",
      });
      expect(await privateRead.json()).toEqual({ ok: true });
      expect(requests).toEqual([
        { url: "/public/shares/session-1", authorization: undefined, owner: undefined },
        {
          url: "/shares/session-1",
          authorization: `Bearer ${envState.SHARING_SERVICE_SECRET}`,
          owner: "fixture-owner",
        },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
