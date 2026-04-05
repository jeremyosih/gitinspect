import { env } from "@gitinspect/env/server";
import { createFileRoute } from "@tanstack/react-router";
import { autumnHandler } from "autumn-js/fetch";

import {
  assertAllowedAutumnMutationRequest,
  resolveAutumnCustomerData,
  trackAutumnMessageUsage,
} from "@/lib/autumn.server";

const autumnApiKey = env.AUTUMN_API_KEY;

const handleAutumnRequest = autumnHandler({
  identify: async (request) => {
    const identity = await resolveAutumnCustomerData(request);

    if (!identity) {
      return null;
    }

    return identity;
  },
  pathPrefix: "/api/autumn",
  secretKey: autumnApiKey,
});

export const Route = createFileRoute("/api/autumn/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        if (!autumnApiKey) {
          return Response.json(
            {
              error:
                "Autumn is not configured yet. Add AUTUMN_API_KEY and run `npx atmn init` to generate autumn.config.ts.",
            },
            { status: 503 },
          );
        }

        const url = new URL(request.url);

        if (url.pathname === "/api/autumn/track-message") {
          if (request.method !== "POST") {
            return Response.json({ error: "Method not allowed" }, { status: 405 });
          }

          const denied = assertAllowedAutumnMutationRequest(request);

          if (denied) {
            return denied;
          }

          try {
            await trackAutumnMessageUsage(request);
            return Response.json({ ok: true }, { status: 200 });
          } catch (error) {
            console.error("Autumn message tracking failed", error);
            return Response.json({ error: "Could not track message usage" }, { status: 502 });
          }
        }

        return await handleAutumnRequest(request);
      },
    },
  },
});
