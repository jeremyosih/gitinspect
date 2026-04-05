import { auth } from "@gitinspect/auth";
import { env } from "@gitinspect/env/server";
import { Autumn } from "autumn-js";

export const AUTUMN_MESSAGES_FEATURE_ID = "messages";

const autumnClient = env.AUTUMN_API_KEY
  ? new Autumn({
      secretKey: env.AUTUMN_API_KEY,
    })
  : null;

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

export function assertAllowedAutumnMutationRequest(request: Request): Response | null {
  if (!hasJsonContentType(request)) {
    return Response.json({ error: "Expected application/json" }, { status: 415 });
  }

  const allowedOrigin = parseOrigin(env.CORS_ORIGIN);
  const requestOrigin = request.headers.get("origin");

  if (!allowedOrigin || !requestOrigin || requestOrigin !== allowedOrigin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const referer = request.headers.get("referer");

  if (referer && !referer.startsWith(`${allowedOrigin}/`) && referer !== allowedOrigin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}

export async function resolveAutumnCustomerId(request: Request): Promise<string | null> {
  try {
    const githubAccount = await auth.api.accountInfo({
      headers: request.headers,
    });

    if (githubAccount?.user.id) {
      return `gh-${githubAccount.user.id}`;
    }
  } catch {
    // Billing identity should stay canonical. If GitHub account info is unavailable,
    // do not fall back to a different identifier shape.
  }

  return null;
}

export async function resolveAutumnCustomerData(request: Request): Promise<{
  customerData: { email: string; name: string | null };
  customerId: string;
} | null> {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user.id) {
    return null;
  }

  const customerId = await resolveAutumnCustomerId(request);

  if (!customerId || !session.user.email) {
    return null;
  }

  return {
    customerData: {
      email: session.user.email,
      name: session.user.name ?? null,
    },
    customerId,
  };
}

export async function trackAutumnMessageUsage(request: Request): Promise<void> {
  if (!autumnClient) {
    throw new Error("Autumn is not configured yet.");
  }

  const identity = await resolveAutumnCustomerData(request);

  if (!identity) {
    throw new Error("Could not resolve Autumn customer.");
  }

  await autumnClient.track({
    customerId: identity.customerId,
    featureId: AUTUMN_MESSAGES_FEATURE_ID,
    value: 1,
  });
}
