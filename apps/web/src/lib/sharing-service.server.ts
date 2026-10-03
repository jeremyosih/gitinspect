import { env } from "@gitinspect/env/server";

/** Host-independent bridge: only this server knows the sharing service secret. */
export async function sharingServiceRequest(input: {
  sessionId: string;
  publicView?: boolean;
  ownerUserId?: string;
  method?: "GET" | "PUT" | "DELETE";
  body?: string;
}): Promise<Response> {
  if (!env.SHARING_SERVICE_URL || (!input.publicView && !env.SHARING_SERVICE_SECRET))
    return Response.json({ error: "Public sharing is not configured" }, { status: 503 });
  const url = new URL(
    `${input.publicView ? "/public" : ""}/shares/${encodeURIComponent(input.sessionId)}`,
    env.SHARING_SERVICE_URL,
  );
  const response = await fetch(url, {
    method: input.method ?? "GET",
    body: input.body,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: input.publicView
      ? {}
      : {
          authorization: `Bearer ${env.SHARING_SERVICE_SECRET}`,
          "x-share-owner": input.ownerUserId!,
          "content-type": "application/json",
        },
  });
  // Fetch decompresses upstream bodies, but preserves their wire headers.
  // Forward decoded bytes without asking the browser to decompress them again.
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
