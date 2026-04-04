import * as React from "react";
import { CircleHelp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  type AuthDialogMode,
  type AuthDialogVariant,
  useGitHubAuthContext,
} from "@gitinspect/ui/components/github-auth-context";
import { Button } from "@gitinspect/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@gitinspect/ui/components/dialog";
import { Icons } from "@gitinspect/ui/components/icons";
import { Separator } from "@gitinspect/ui/components/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@gitinspect/ui/components/tooltip";

export function AuthDialog(props: {
  mode: AuthDialogMode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  variant: AuthDialogVariant;
}) {
  const auth = useGitHubAuthContext();
  const [isLoading, setIsLoading] = React.useState(false);
  const [isGuestLoading, setIsGuestLoading] = React.useState(false);

  if (!auth) {
    return null;
  }

  const isFirstMessage = props.variant === "first-message";
  const showFullOptions = props.mode === "full";

  const handleSignIn = async () => {
    setIsLoading(true);

    try {
      await auth.signIn();
    } catch (error) {
      console.error(error);
      toast.error("Could not start GitHub sign-in");
      setIsLoading(false);
    }
  };

  const handlePatFallback = () => {
    props.onOpenChange(false);
    auth.openGithubSettings();
  };

  const handleContinueWithoutToken = async () => {
    if (!isFirstMessage) {
      props.onOpenChange(false);
      return;
    }

    setIsGuestLoading(true);

    try {
      await auth.continueAsGuest();
    } catch (error) {
      console.error(error);
      toast.error("Could not continue without a token");
    } finally {
      setIsGuestLoading(false);
    }
  };

  return (
    <Dialog onOpenChange={props.onOpenChange} open={props.open}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Continue with GitHub</DialogTitle>
          <DialogDescription className="space-y-1 pt-1 text-left">
            <span className="block font-medium text-foreground">Access free models.</span>
            <span className="block">Your token stays local in this browser.</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            className="w-full gap-2"
            disabled={isLoading || isGuestLoading}
            onClick={() => void handleSignIn()}
            size="lg"
            type="button"
          >
            <Icons.gitHub className="size-4" />
            <span>Continue with GitHub</span>
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : null}
          </Button>

          {showFullOptions ? (
            <>
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <Separator className="flex-1" />
                  <span>or</span>
                  <Separator className="flex-1" />
                </div>
                <div className="space-y-1 text-left">
                  <span className="block font-medium text-foreground">No free models.</span>
                  <span className="block text-sm text-muted-foreground">
                    You&apos;ll need to add an AI provider.
                  </span>
                </div>
              </div>

              <div className="space-y-3 text-center text-xs text-muted-foreground">
                <div className="relative">
                  <Button
                    className="w-full pr-10"
                    disabled={isLoading || isGuestLoading}
                    onClick={handlePatFallback}
                    size="lg"
                    type="button"
                    variant="outline"
                  >
                    Personal Access Token
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        aria-label="What is a personal access token?"
                        className="absolute top-1/2 right-3 inline-flex -translate-y-1/2 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                        disabled={isLoading || isGuestLoading}
                        type="button"
                      >
                        <CircleHelp className="size-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px] text-left" side="top" sideOffset={6}>
                      Stored only in this browser. Use a personal access token for private repos.
                      Personal access tokens don&apos;t unlock free models.
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div>
                  <button
                    className="font-medium text-foreground underline underline-offset-4"
                    disabled={isLoading || isGuestLoading}
                    onClick={() => void handleContinueWithoutToken()}
                    type="button"
                  >
                    {isGuestLoading
                      ? "Continuing…"
                      : "Continue without token (limited to public repos, 60 requests/hour)"}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
