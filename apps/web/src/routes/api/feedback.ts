import { env } from "@gitinspect/env/server";
import { createFileRoute } from "@tanstack/react-router";
import { feedbackSchema, normalizeFeedbackPayload } from "@gitinspect/shared/feedback";
import { assertAllowedFeedbackRequest, createFeedbackIssue } from "@/lib/feedback.server";

export const Route = createFileRoute("/api/feedback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!env.FEEDBACK_GITHUB_TOKEN || !env.FEEDBACK_GITHUB_OWNER || !env.FEEDBACK_GITHUB_REPO) {
          return Response.json({ error: "Feedback is not configured" }, { status: 503 });
        }

        const denied = assertAllowedFeedbackRequest(request, env.CORS_ORIGIN);

        if (denied) {
          console.error("Feedback request rejected by route guards", {
            origin: request.headers.get("origin"),
            referer: request.headers.get("referer"),
          });
          return denied;
        }

        const json: unknown = await request.json().catch(() => null);

        if (json === null) {
          console.error("Feedback request body was not valid JSON");
          return Response.json({ error: "Invalid feedback payload" }, { status: 400 });
        }

        const parsed = feedbackSchema.safeParse(json);

        if (!parsed.success) {
          console.error("Feedback request payload failed validation", parsed.error.flatten());
          return Response.json({ error: "Invalid feedback payload" }, { status: 400 });
        }

        if (parsed.data.website) {
          console.error("Feedback request rejected due to honeypot field", {
            origin: request.headers.get("origin"),
          });
          return Response.json({ error: "Invalid feedback payload" }, { status: 400 });
        }

        try {
          const issue = await createFeedbackIssue({
            owner: env.FEEDBACK_GITHUB_OWNER,
            payload: normalizeFeedbackPayload(parsed.data),
            referer: request.headers.get("referer"),
            repo: env.FEEDBACK_GITHUB_REPO,
            token: env.FEEDBACK_GITHUB_TOKEN,
            userAgent: request.headers.get("user-agent"),
          });

          return Response.json(
            {
              issueNumber: issue.number,
              issueUrl: issue.html_url,
              ok: true,
            },
            { status: 201 },
          );
        } catch (error) {
          console.error("Feedback issue creation failed", error);
          return Response.json({ error: "Could not send feedback right now" }, { status: 502 });
        }
      },
    },
  },
});
