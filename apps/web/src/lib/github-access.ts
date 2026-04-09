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
const ACCOUNT_CACHE_TTL_MS = 30_000;
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 30_000;

type BetterAuthSessionResult = Awaited<ReturnType<typeof authClient.getSession>>;
type ProductSession = ExtractSessionResult<BetterAuthSessionResult>;

type ExtractSessionResult<T> = T extends { data: infer Data } ? Data : T;

type RepoScopeStatus = {
  githubLink: GitHubAuthState["githubLink"];
  repoAccess: GitHubAuthState["repoAccess"];
  source: "oauth" | "pat" | "none";
};

type PendingRepoAccessState = {
  createdAt: number;
};

type SessionStoreSnapshot = {
  data: ProductSession | null;
  isPending: boolean;
};

type GitHubLinkedAccount = {
  providerId: string;
  scopes?: string[];
};

type GitHubAccessToken = {
  accessToken?: string;
  accessTokenExpiresAt?: Date | string;
  scopes?: string[];
};

type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

type CachedToken = {
  expiresAt: number | null;
  value: GitHubAccessToken | null;
};

export type RepoAccessContinuationStatus = "none" | "ready" | "requested-grant";

let productSessionPromise: Promise<ProductSession | null> | undefined;
let githubAccountCache: CachedValue<GitHubLinkedAccount | null | undefined> | undefined;
let githubAccountPromise: Promise<GitHubLinkedAccount | null | undefined> | undefined;
let githubAccessTokenCache: CachedToken | undefined;
let githubAccessTokenPromise: Promise<GitHubAccessToken | null> | undefined;
let hasRegisteredSessionInvalidation = false;

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

  const state: PendingRepoAccessState = {
    createdAt: Date.now(),
  };

  window.sessionStorage.setItem(PENDING_REPO_ACCESS_KEY, JSON.stringify(state));
}

function readPendingRepoAccessState(): PendingRepoAccessState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(PENDING_REPO_ACCESS_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PendingRepoAccessState;

    if (typeof parsed.createdAt === "number" && Number.isFinite(parsed.createdAt)) {
      return parsed;
    }
  } catch {
    window.sessionStorage.removeItem(PENDING_REPO_ACCESS_KEY);
    return null;
  }

  window.sessionStorage.removeItem(PENDING_REPO_ACCESS_KEY);
  return null;
}

export function hasPendingRepoAccessGrant(): boolean {
  return readPendingRepoAccessState() !== null;
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

function unwrapAuthFetchData<T>(result: unknown): T | null {
  if (result && typeof result === "object" && "data" in result) {
    return ((result as { data?: T | null }).data ?? null) as T | null;
  }

  return (result as T | null) ?? null;
}

function readSessionStoreSnapshot(): ProductSession | null | undefined {
  const sessionAtom = authClient.$store.atoms.session as {
    get?: () => SessionStoreSnapshot | undefined;
  };
  const snapshot = sessionAtom?.get?.();

  if (!snapshot) {
    return undefined;
  }

  if (snapshot.data) {
    return snapshot.data;
  }

  if (!snapshot.isPending) {
    return null;
  }

  return undefined;
}

function isRepoScopeGranted(scopes: ReadonlyArray<string> | undefined): boolean {
  if (!scopes) {
    return false;
  }

  return scopes.includes(GITHUB_REPO_SCOPE);
}

function getAccessTokenExpiresAtMs(token: GitHubAccessToken | null): number | null {
  const raw = token?.accessTokenExpiresAt;

  if (!raw) {
    return null;
  }

  const expiresAt = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

function hasValidCachedAccessToken(): boolean {
  const cached = githubAccessTokenCache;

  if (!cached?.value?.accessToken) {
    return false;
  }

  return cached.expiresAt === null || cached.expiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS > Date.now();
}

function hasFreshAccountCache(): boolean {
  return Boolean(githubAccountCache && githubAccountCache.expiresAt > Date.now());
}

export function invalidateGitHubAuthCache(): void {
  productSessionPromise = undefined;
  githubAccountCache = undefined;
  githubAccountPromise = undefined;
  githubAccessTokenCache = undefined;
  githubAccessTokenPromise = undefined;
}

function ensureSessionInvalidationBridge(): void {
  if (hasRegisteredSessionInvalidation) {
    return;
  }

  hasRegisteredSessionInvalidation = true;
  authClient.$store.listen("$sessionSignal", () => {
    invalidateGitHubAuthCache();
  });
}

async function getProductSession(): Promise<ProductSession | null> {
  const cached = readSessionStoreSnapshot();

  if (cached !== undefined) {
    return cached;
  }

  if (productSessionPromise) {
    return await productSessionPromise;
  }

  productSessionPromise = authClient
    .getSession()
    .then(getSessionPayload)
    .catch(() => null)
    .finally(() => {
      productSessionPromise = undefined;
    });

  return await productSessionPromise;
}

async function getGithubLinkedAccount(input?: {
  force?: boolean;
  session?: ProductSession | null;
}): Promise<GitHubLinkedAccount | null | undefined> {
  const session = input?.session !== undefined ? input.session : await getProductSession();

  if (!session) {
    return null;
  }

  if (!input?.force && hasFreshAccountCache()) {
    return githubAccountCache?.value;
  }

  if (githubAccountPromise) {
    return await githubAccountPromise;
  }

  githubAccountPromise = authClient
    .$fetch("/list-accounts", {
      method: "GET",
    })
    .then((result) => {
      const accounts = unwrapAuthFetchData<GitHubLinkedAccount[]>(result) ?? [];
      const githubAccount = accounts.find((account) => account.providerId === "github") ?? null;

      githubAccountCache = {
        expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS,
        value: githubAccount,
      };

      return githubAccount;
    })
    .catch(() => {
      githubAccountCache = {
        expiresAt: Date.now() + ACCOUNT_CACHE_TTL_MS,
        value: undefined,
      };

      return undefined;
    })
    .finally(() => {
      githubAccountPromise = undefined;
    });

  return await githubAccountPromise;
}

async function getGithubOAuthAccessToken(input?: {
  force?: boolean;
  session?: ProductSession | null;
}): Promise<GitHubAccessToken | null> {
  const session = input?.session !== undefined ? input.session : await getProductSession();

  if (!session) {
    return null;
  }

  if (!input?.force && hasValidCachedAccessToken()) {
    return githubAccessTokenCache?.value ?? null;
  }

  if (githubAccessTokenPromise) {
    return await githubAccessTokenPromise;
  }

  githubAccessTokenPromise = authClient
    .$fetch("/get-access-token", {
      body: {
        providerId: "github",
      },
      method: "POST",
    })
    .then((result) => {
      const token = unwrapAuthFetchData<GitHubAccessToken>(result);

      githubAccessTokenCache = {
        expiresAt: getAccessTokenExpiresAtMs(token),
        value: token,
      };

      return token;
    })
    .catch(() => null)
    .finally(() => {
      githubAccessTokenPromise = undefined;
    });

  return await githubAccessTokenPromise;
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
  const [session, fallbackPat, githubAccount] = await Promise.all([
    getProductSession(),
    getGithubPersonalAccessToken(),
    getGithubLinkedAccount(),
  ]);

  if (!session) {
    if (fallbackPat) {
      return {
        ok: true,
        source: "pat",
        token: fallbackPat,
      };
    }

    return failure("signed-out");
  }

  if (githubAccount === null) {
    if (fallbackPat) {
      return {
        ok: true,
        source: "pat",
        token: fallbackPat,
      };
    }

    return failure("oauth-not-linked");
  }

  if (githubAccount && requireRepoScope && !isRepoScopeGranted(githubAccount.scopes)) {
    if (fallbackPat) {
      return {
        ok: true,
        source: "pat",
        token: fallbackPat,
      };
    }

    return failure("oauth-missing-scope");
  }

  const oauthToken = await getGithubOAuthAccessToken({ session });

  if (oauthToken?.accessToken) {
    const scopes = oauthToken.scopes ?? githubAccount?.scopes;

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

  return failure("oauth-failed");
}

export async function signInWithGithub(): Promise<void> {
  invalidateGitHubAuthCache();
  await authClient.signIn.social({
    callbackURL: getCallbackUrl(),
    provider: "github",
    scopes: [GITHUB_REPO_SCOPE],
  });
}

export async function requestGithubRepoAccess(): Promise<void> {
  const session = await getProductSession();

  if (!session) {
    markPendingRepoAccess();
    await signInWithGithub();
    return;
  }

  invalidateGitHubAuthCache();
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

export async function continuePendingGithubRepoAccessGrant(): Promise<RepoAccessContinuationStatus> {
  if (!hasPendingRepoAccessGrant()) {
    return "none";
  }

  const access = await resolveGitHubAccess({ requireRepoScope: true });

  if (access.ok) {
    clearPendingRepoAccessGrant();
    return "ready";
  }

  const session = await getProductSession();

  if (!session) {
    return "none";
  }

  clearPendingRepoAccessGrant();
  invalidateGitHubAuthCache();
  await authClient.linkSocial({
    callbackURL: getCallbackUrl(),
    provider: "github",
    scopes: [GITHUB_REPO_SCOPE],
  });
  return "requested-grant";
}

export async function signOutGithubProductSession(): Promise<void> {
  clearPendingRepoAccessGrant();
  invalidateGitHubAuthCache();
  await authClient.signOut();

  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

export async function deriveGitHubAuthState(input?: {
  session?: ProductSession | null;
}): Promise<GitHubAuthState> {
  const [session, fallbackPat] = await Promise.all([
    input?.session !== undefined ? input.session : getProductSession(),
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

  const githubAccount = await getGithubLinkedAccount({ session });

  if (githubAccount === undefined) {
    return {
      fallbackPat: Boolean(fallbackPat),
      githubLink: "unknown",
      preferredSource: fallbackPat ? "pat" : "none",
      repoAccess: "unknown",
      session: "signed-in",
    };
  }

  if (!githubAccount) {
    return {
      fallbackPat: Boolean(fallbackPat),
      githubLink: "unlinked",
      preferredSource: fallbackPat ? "pat" : "none",
      repoAccess: "missing",
      session: "signed-in",
    };
  }

  return {
    fallbackPat: Boolean(fallbackPat),
    githubLink: "linked",
    preferredSource: "oauth",
    repoAccess: isRepoScopeGranted(githubAccount.scopes) ? "granted" : "missing",
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

ensureSessionInvalidationBridge();
registerGitHubAccessResolver(resolveGitHubAccess);
