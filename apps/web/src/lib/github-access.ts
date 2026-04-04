import { authClient } from "@/lib/auth-client";
import {
  type GitHubAccess,
  type GitHubAccessFailureReason,
  type GitHubAuthState,
  type ResolveGitHubAccessOptions,
  registerGitHubAccessResolver,
} from "@gitinspect/pi/repo/github-access";
import { getGithubPersonalAccessToken } from "@gitinspect/pi/repo/github-token";

const GITHUB_REPO_SCOPE = "repo";
const PENDING_REPO_ACCESS_KEY = "gitinspect.pending-github-repo-access";

type BetterAuthSessionResult = Awaited<ReturnType<typeof authClient.getSession>>;
type BetterAuthAccessTokenResult = Awaited<ReturnType<typeof authClient.getAccessToken>>;

type ProductSession = ExtractSessionResult<BetterAuthSessionResult>;

type ExtractSessionResult<T> = T extends { data: infer Data } ? Data : T;

type RepoScopeStatus = {
  githubLink: GitHubAuthState["githubLink"];
  repoAccess: GitHubAuthState["repoAccess"];
  source: "oauth" | "pat" | "none";
};

function getCallbackUrl(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  return `${window.location.pathname}${window.location.search}`;
}

function markPendingRepoAccess(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(PENDING_REPO_ACCESS_KEY, "1");
}

export function hasPendingRepoAccessGrant(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.sessionStorage.getItem(PENDING_REPO_ACCESS_KEY) === "1";
}

export function clearPendingRepoAccessGrant(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(PENDING_REPO_ACCESS_KEY);
}

function getSessionPayload(result: BetterAuthSessionResult): ProductSession | null {
  if (result && typeof result === "object" && "data" in result) {
    return result.data ?? null;
  }

  return result ?? null;
}

function getAccessTokenPayload(result: BetterAuthAccessTokenResult): BetterAuthAccessTokenResult {
  return result;
}

function isRepoScopeGranted(scopes: ReadonlyArray<string> | undefined): boolean {
  if (!scopes) {
    return false;
  }

  return scopes.includes(GITHUB_REPO_SCOPE);
}

async function getProductSession(): Promise<ProductSession | null> {
  try {
    return getSessionPayload(await authClient.getSession());
  } catch {
    return null;
  }
}

async function getGithubOAuthAccessToken(): Promise<BetterAuthAccessTokenResult | null> {
  try {
    return getAccessTokenPayload(
      await authClient.getAccessToken({
        providerId: "github",
      }),
    );
  } catch {
    return null;
  }
}

function failure(reason: GitHubAccessFailureReason): GitHubAccess {
  return {
    ok: false,
    reason,
  };
}

export async function resolveGitHubAccess(
  options?: ResolveGitHubAccessOptions,
): Promise<GitHubAccess> {
  const requireRepoScope = options?.requireRepoScope === true;
  const [session, fallbackPat] = await Promise.all([
    getProductSession(),
    getGithubPersonalAccessToken(),
  ]);
  const oauthToken = session ? await getGithubOAuthAccessToken() : null;

  if (oauthToken?.accessToken) {
    const scopes = oauthToken.scopes;

    if (!requireRepoScope || isRepoScopeGranted(scopes)) {
      return {
        ok: true,
        scopes,
        source: "oauth",
        token: oauthToken.accessToken,
      };
    }

    if (fallbackPat) {
      return {
        ok: true,
        source: "pat",
        token: fallbackPat,
      };
    }

    return failure("oauth-missing-scope");
  }

  if (fallbackPat) {
    return {
      ok: true,
      source: "pat",
      token: fallbackPat,
    };
  }

  if (!session) {
    return failure("signed-out");
  }

  return failure("oauth-failed");
}

export async function signInWithGithub(): Promise<void> {
  await authClient.signIn.social({
    callbackURL: getCallbackUrl(),
    provider: "github",
  });
}

export async function requestGithubRepoAccess(): Promise<void> {
  const session = await getProductSession();

  if (!session) {
    markPendingRepoAccess();
    await signInWithGithub();
    return;
  }

  await authClient.linkSocial({
    callbackURL: getCallbackUrl(),
    provider: "github",
    scopes: [GITHUB_REPO_SCOPE],
  });
}

export async function ensureGitHubRepoAccess(): Promise<void> {
  const access = await resolveGitHubAccess({ requireRepoScope: true });

  if (access.ok) {
    return;
  }

  if (access.reason === "signed-out") {
    markPendingRepoAccess();
    await signInWithGithub();
    return;
  }

  await requestGithubRepoAccess();
}

export async function continuePendingGithubRepoAccessGrant(): Promise<void> {
  if (!hasPendingRepoAccessGrant()) {
    return;
  }

  const access = await resolveGitHubAccess({ requireRepoScope: true });

  if (access.ok) {
    clearPendingRepoAccessGrant();
    return;
  }

  const session = await getProductSession();

  if (!session) {
    return;
  }

  clearPendingRepoAccessGrant();
  await authClient.linkSocial({
    callbackURL: getCallbackUrl(),
    provider: "github",
    scopes: [GITHUB_REPO_SCOPE],
  });
}

export async function signOutGithubProductSession(): Promise<void> {
  clearPendingRepoAccessGrant();
  await authClient.signOut();
}

export async function deriveGitHubAuthState(): Promise<GitHubAuthState> {
  const [session, fallbackPat] = await Promise.all([
    getProductSession(),
    getGithubPersonalAccessToken(),
  ]);

  if (!session) {
    return {
      fallbackPat: Boolean(fallbackPat),
      githubLink: "unlinked",
      preferredSource: fallbackPat ? "pat" : "none",
      repoAccess: "missing",
      session: "signed-out",
    };
  }

  const oauthToken = await getGithubOAuthAccessToken();

  if (oauthToken?.accessToken) {
    const repoGranted = isRepoScopeGranted(oauthToken.scopes);

    return {
      fallbackPat: Boolean(fallbackPat),
      githubLink: "linked",
      preferredSource: "oauth",
      repoAccess: repoGranted ? "granted" : "missing",
      session: "signed-in",
    };
  }

  return {
    fallbackPat: Boolean(fallbackPat),
    githubLink: "unknown",
    preferredSource: fallbackPat ? "pat" : "none",
    repoAccess: "unknown",
    session: "signed-in",
  };
}

export async function getRepoScopeStatus(): Promise<RepoScopeStatus> {
  const state = await deriveGitHubAuthState();

  return {
    githubLink: state.githubLink,
    repoAccess: state.repoAccess,
    source: state.preferredSource,
  };
}

registerGitHubAccessResolver(resolveGitHubAccess);
