import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import {
  GITHUB_CREATE_PAT_URL,
  getGithubPersonalAccessToken,
  setGithubPersonalAccessToken,
  validateGithubPersonalAccessToken,
} from "@gitinspect/pi/repo/github-token";
import { toast } from "sonner";
import { useGitHubAuthContext } from "@gitinspect/ui/components/github-auth-context";
import { Button } from "@gitinspect/ui/components/button";
import { Input } from "@gitinspect/ui/components/input";
import { Label } from "@gitinspect/ui/components/label";
import { cn } from "@gitinspect/ui/lib/utils";

function getPrimaryButtonLabel(input: {
  repoAccess: "granted" | "missing" | "unknown";
  session: "signed-in" | "signed-out";
}): string {
  if (input.session === "signed-out") {
    return "Sign in with GitHub";
  }

  if (input.repoAccess === "missing") {
    return "Grant repo access";
  }

  return "Reconnect GitHub";
}

export function GithubTokenSettings(props: {
  disabled?: boolean;
  onTokenSaved?: () => void | Promise<void>;
}) {
  const auth = useGitHubAuthContext();
  const [token, setToken] = React.useState("");
  const [hasSavedToken, setHasSavedToken] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isPrimaryActionLoading, setIsPrimaryActionLoading] = React.useState(false);

  React.useEffect(() => {
    let disposed = false;

    void (async () => {
      const stored = await getGithubPersonalAccessToken();

      if (disposed) {
        return;
      }

      const present = Boolean(stored?.trim());
      setToken(stored ?? "");
      setHasSavedToken(present);
      setIsLoading(false);
    })();

    return () => {
      disposed = true;
    };
  }, []);

  const authState = auth?.authState;
  const primaryButtonLabel = getPrimaryButtonLabel({
    repoAccess: authState?.repoAccess ?? "unknown",
    session: authState?.session ?? "signed-out",
  });

  return (
    <div className="space-y-4">
      <div className="rounded-none border border-foreground/10 p-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">Sign in with GitHub</div>
          <p className="text-xs text-muted-foreground">
            Recommended for free features, better limits, and the future sync, share, and
            subscription path.
          </p>
        </div>

        <div className="mt-4 rounded-none border border-border/70 bg-muted/20 p-3 text-xs">
          <div className="font-medium text-foreground">Connection status</div>
          <div className="mt-2 grid gap-2 text-muted-foreground sm:grid-cols-2">
            <div>
              <div className="font-medium text-foreground">Product session</div>
              <div>{authState?.session === "signed-in" ? "Signed in" : "Signed out"}</div>
            </div>
            <div>
              <div className="font-medium text-foreground">Repo auth source</div>
              <div>
                {authState?.preferredSource === "oauth"
                  ? "OAuth"
                  : authState?.preferredSource === "pat"
                    ? "PAT fallback"
                    : "None"}
              </div>
            </div>
            <div>
              <div className="font-medium text-foreground">GitHub link</div>
              <div>{authState?.githubLink ?? "unknown"}</div>
            </div>
            <div>
              <div className="font-medium text-foreground">Repo access</div>
              <div>{authState?.repoAccess ?? "unknown"}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            disabled={props.disabled || isPrimaryActionLoading || !auth}
            onClick={async () => {
              if (!auth) {
                return;
              }

              setIsPrimaryActionLoading(true);

              try {
                if (auth.authState.session === "signed-out") {
                  await auth.signIn();
                } else {
                  await auth.ensureRepoAccess();
                }
              } catch (error) {
                console.error(error);
                toast.error("Could not start the GitHub flow");
                setIsPrimaryActionLoading(false);
              }
            }}
            size="sm"
            type="button"
          >
            {isPrimaryActionLoading ? "Working…" : primaryButtonLabel}
          </Button>
          {authState?.session === "signed-in" ? (
            <Button
              disabled={props.disabled || isPrimaryActionLoading || !auth}
              onClick={async () => {
                if (!auth) {
                  return;
                }

                setIsPrimaryActionLoading(true);

                try {
                  await auth.signOut();
                  toast.success("Signed out");
                } catch (error) {
                  console.error(error);
                  toast.error("Could not sign out");
                } finally {
                  setIsPrimaryActionLoading(false);
                }
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Sign out
            </Button>
          ) : null}
        </div>

        <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
          <div>• Product auth unlocks account-linked features and better rate limits.</div>
          <div>• Repository access is requested only when a repo action actually needs it.</div>
          <div>
            • Stateless Better Auth sessions and linked GitHub account data live in secure cookies.
          </div>
        </div>
      </div>

      <div className="rounded-none border border-dashed border-foreground/15 p-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">Advanced PAT fallback</div>
          <p className="text-xs text-muted-foreground">
            Best for privacy-sensitive fallback use. PAT works for direct GitHub API access, but the
            app still treats PAT-only usage as signed out for free-model perks and future
            sync/share/subscription features.
          </p>
        </div>

        {!isLoading && !hasSavedToken ? (
          <Button
            className="mt-4 h-8 w-full gap-1 text-xs sm:w-auto"
            disabled={props.disabled || isSaving}
            onClick={() => {
              window.open(GITHUB_CREATE_PAT_URL, "_blank", "noopener,noreferrer");
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Generate GitHub Token
            <ArrowUpRight className="size-3.5 opacity-70" />
          </Button>
        ) : null}

        <div className={cn("space-y-2", !isLoading && !hasSavedToken ? "mt-3" : "mt-4")}>
          <Label htmlFor="github-pat">Access token</Label>
          <Input
            autoComplete="off"
            disabled={props.disabled || isLoading || isSaving}
            id="github-pat"
            onChange={(event) => setToken(event.target.value)}
            placeholder="github_pat_…"
            type="password"
            value={token}
          />
          <p className="text-xs text-muted-foreground">
            Stored only in this browser. Fine-grained token with read-only contents access is
            recommended.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            disabled={props.disabled || isLoading || isSaving}
            onClick={async () => {
              const next = token.trim();
              setIsSaving(true);
              try {
                if (!next) {
                  setToken("");
                  await setGithubPersonalAccessToken(undefined);
                  setHasSavedToken(false);
                  toast.success("GitHub token cleared");
                  await props.onTokenSaved?.();
                  return;
                }

                const result = await validateGithubPersonalAccessToken(next);
                if (!result.ok) {
                  toast.error(result.message);
                  return;
                }

                await setGithubPersonalAccessToken(next);
                setHasSavedToken(true);
                toast.success(`GitHub PAT saved for @${result.login}`);
                await props.onTokenSaved?.();
              } catch {
                toast.error("Could not save GitHub token");
              } finally {
                setIsSaving(false);
              }
            }}
            size="sm"
            type="button"
          >
            Save token
          </Button>
          {!isLoading && hasSavedToken ? (
            <Button
              disabled={props.disabled || isSaving}
              onClick={async () => {
                setIsSaving(true);
                try {
                  setToken("");
                  await setGithubPersonalAccessToken(undefined);
                  setHasSavedToken(false);
                  toast.success("GitHub token deleted");
                  await props.onTokenSaved?.();
                } catch {
                  toast.error("Could not delete GitHub token");
                } finally {
                  setIsSaving(false);
                }
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Delete token
            </Button>
          ) : null}
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Public stars and language come from a tiny server endpoint for public repos only. Private
          repo reads and chat file fetches still happen client-side with your OAuth token or PAT.
        </p>
      </div>
    </div>
  );
}
