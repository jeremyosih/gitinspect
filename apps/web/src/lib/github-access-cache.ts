import { authClient } from "@/lib/auth-client";
import { authQueryClient } from "@/lib/auth-query-client";

const GITHUB_ACCESS_TOKEN_QUERY_KEY = ["auth", "github", "access-token"] as const;
const GITHUB_ACCESS_TOKEN_STALE_TIME_MS = 10 * 60 * 1000;
const GITHUB_ACCESS_TOKEN_GC_TIME_MS = 60 * 60 * 1000;

let hasRegisteredSessionSignalListener = false;

type GitHubAccessTokenResult = Awaited<ReturnType<typeof authClient.getAccessToken>>;

function ensureSessionSignalListener(): void {
  if (typeof window === "undefined" || hasRegisteredSessionSignalListener) {
    return;
  }

  hasRegisteredSessionSignalListener = true;
  authClient.$store.listen("$sessionSignal", () => {
    authQueryClient.removeQueries({
      queryKey: GITHUB_ACCESS_TOKEN_QUERY_KEY,
    });
  });
}

export async function getCachedGitHubOAuthAccessToken(): Promise<GitHubAccessTokenResult | null> {
  ensureSessionSignalListener();

  try {
    return await authQueryClient.fetchQuery({
      gcTime: GITHUB_ACCESS_TOKEN_GC_TIME_MS,
      queryFn: async () =>
        await authClient.getAccessToken({
          providerId: "github",
        }),
      queryKey: GITHUB_ACCESS_TOKEN_QUERY_KEY,
      staleTime: GITHUB_ACCESS_TOKEN_STALE_TIME_MS,
    });
  } catch {
    return null;
  }
}

export async function invalidateCachedGitHubOAuthAccessToken(): Promise<void> {
  ensureSessionSignalListener();

  await authQueryClient.invalidateQueries({
    queryKey: GITHUB_ACCESS_TOKEN_QUERY_KEY,
  });
}

export async function clearCachedGitHubOAuthAccessToken(): Promise<void> {
  ensureSessionSignalListener();

  await authQueryClient.removeQueries({
    queryKey: GITHUB_ACCESS_TOKEN_QUERY_KEY,
  });
}
