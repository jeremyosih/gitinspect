import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import {
  GITHUB_CREATE_PAT_URL,
  getGithubPersonalAccessToken,
  setGithubPersonalAccessToken,
  validateGithubPersonalAccessToken,
} from "@gitinspect/runtime/repo/github-token";
import { toast } from "sonner";
import { useGitHubAuthContext } from "@gitinspect/ui/components/github-auth-context";
import { Button } from "@gitinspect/ui/components/button";
import { Input } from "@gitinspect/ui/components/input";
import { Label } from "@gitinspect/ui/components/label";
import { AUTH_STORAGE_SUMMARY } from "@gitinspect/ui/lib/auth-copy";
import { getGitHubConnectionSummary } from "@gitinspect/ui/lib/github-auth-summary";
import { cn } from "@gitinspect/ui/lib/utils";

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
  const summary = authState ? getGitHubConnectionSummary(authState) : null;

  async function handlePrimaryAction(): Promise<void> {
    if (!auth || !summary || summary.primaryAction === "none") {
      return;
    }

    setIsPrimaryActionLoading(true);

    try {
      if (summary.primaryAction === "sign-in") {
        await auth.signIn();
        return;
      }

      if (summary.primaryAction === "grant-repo-access" || summary.primaryAction === "reconnect") {
        await auth.ensureRepoAccess();
      }
    } catch (error) {
      console.error(error);
      toast.error("Could not start the GitHub flow");
      setIsPrimaryActionLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-none border border-foreground/10 p-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">GitHub</div>
          <p className="text-xs text-muted-foreground">
            Sign in with GitHub to use free models and private repos.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {summary?.primaryLabel ? (
            <Button
              disabled={props.disabled || isPrimaryActionLoading || !auth}
              onClick={() => {
                void handlePrimaryAction();
              }}
              size="sm"
              type="button"
            >
              {isPrimaryActionLoading ? "Working…" : summary.primaryLabel}
            </Button>
          ) : null}
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
                  toast.success(
                    hasSavedToken
                      ? "Signed out. Your Personal Access Token is still saved in this browser."
                      : "Signed out",
                  );
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
          <div>{AUTH_STORAGE_SUMMARY}</div>
        </div>
      </div>

      <div className="rounded-none border border-dashed border-foreground/15 p-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">Use Personal Access Token instead</div>
          <p className="text-xs text-muted-foreground">
            Optional. Use a GitHub Personal Access Token if you don&apos;t want to sign in.
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
            Generate Personal Access Token
            <ArrowUpRight className="size-3.5 opacity-70" />
          </Button>
        ) : null}

        <div className={cn("space-y-2", !isLoading && !hasSavedToken ? "mt-3" : "mt-4")}>
          <Label htmlFor="github-pat">GitHub Personal Access Token</Label>
          <Input
            autoComplete="off"
            disabled={props.disabled || isLoading || isSaving}
            id="github-pat"
            onChange={(event) => setToken(event.target.value)}
            placeholder="github_pat_…"
            type="password"
            value={token}
          />
          <p className="text-xs text-muted-foreground">Stored only in this browser.</p>
          <p className="text-xs text-muted-foreground">Does not unlock free models.</p>
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
                  toast.success("Personal Access Token deleted");
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
                toast.success(`Personal Access Token saved for @${result.login}`);
                await props.onTokenSaved?.();
              } catch {
                toast.error("Could not save Personal Access Token");
              } finally {
                setIsSaving(false);
              }
            }}
            size="sm"
            type="button"
          >
            Save Personal Access Token
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
                  toast.success("Personal Access Token deleted");
                  await props.onTokenSaved?.();
                } catch {
                  toast.error("Could not delete Personal Access Token");
                } finally {
                  setIsSaving(false);
                }
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Delete Personal Access Token
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
