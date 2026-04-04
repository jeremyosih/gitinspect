import {
  buildFeedbackIssueBody,
  buildFeedbackIssueTitle,
  buildFeedbackLabels,
  type FeedbackPayload,
} from "@gitinspect/shared/feedback";

type FeedbackIssueResponse = {
  html_url: string;
  number: number;
};

function parseOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");

  if (!contentType) {
    return false;
  }

  return contentType.toLowerCase().includes("application/json");
}

function isFeedbackIssueResponse(value: unknown): value is FeedbackIssueResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.number === "number" && typeof candidate.html_url === "string";
}

export function isAllowedFeedbackOrigin(request: Request, allowedOrigin: string): boolean {
  const requestOrigin = request.headers.get("origin");
  const normalizedAllowedOrigin = parseOrigin(allowedOrigin);

  if (!requestOrigin || !normalizedAllowedOrigin) {
    return false;
  }

  return requestOrigin === normalizedAllowedOrigin;
}

export function isAllowedFeedbackReferer(request: Request, allowedOrigin: string): boolean {
  const referer = request.headers.get("referer");
  const normalizedAllowedOrigin = parseOrigin(allowedOrigin);

  if (!referer || !normalizedAllowedOrigin) {
    return true;
  }

  return referer.startsWith(`${normalizedAllowedOrigin}/`) || referer === normalizedAllowedOrigin;
}

export function assertAllowedFeedbackRequest(
  request: Request,
  allowedOrigin: string,
): Response | null {
  if (!hasJsonContentType(request)) {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }

  if (!isAllowedFeedbackOrigin(request, allowedOrigin)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isAllowedFeedbackReferer(request, allowedOrigin)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

export async function createFeedbackIssue(input: {
  owner: string;
  payload: FeedbackPayload;
  referer: string | null;
  repo: string;
  token: string;
  userAgent: string | null;
}): Promise<FeedbackIssueResponse> {
  const title = buildFeedbackIssueTitle(input.payload);
  const body = buildFeedbackIssueBody({
    payload: input.payload,
    referer: input.referer,
    submittedAt: new Date().toISOString(),
    userAgent: input.userAgent,
  });
  const labels = buildFeedbackLabels(input.payload);
  const response = await fetch(`https://api.github.com/repos/${input.owner}/${input.repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ body, labels, title }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Feedback GitHub issue creation failed", {
      owner: input.owner,
      repo: input.repo,
      status: response.status,
      statusText: response.statusText,
      text,
    });
    throw new Error("Feedback issue creation failed");
  }

  const json: unknown = await response.json();

  if (!isFeedbackIssueResponse(json)) {
    console.error("Feedback GitHub issue response was invalid", json);
    throw new Error("Feedback issue creation failed");
  }

  return json;
}
