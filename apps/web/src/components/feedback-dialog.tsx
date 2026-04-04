import * as React from "react";
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import type { ResolvedRepoSource, SessionData } from "@gitinspect/db/storage-types";
import { useSelectedSessionSummary } from "@gitinspect/pi/hooks/use-selected-session-summary";
import { parseRepoRoutePath } from "@gitinspect/pi/repo/path-parser";
import { type FeedbackPayload, type FeedbackSentiment } from "@gitinspect/shared/feedback";
import { Button } from "@gitinspect/ui/components/button";
import { Checkbox } from "@gitinspect/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@gitinspect/ui/components/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@gitinspect/ui/components/drawer";
import { Icons } from "@gitinspect/ui/components/icons";
import { Input } from "@gitinspect/ui/components/input";
import { Label } from "@gitinspect/ui/components/label";
import { Textarea } from "@gitinspect/ui/components/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@gitinspect/ui/components/tooltip";
import { useIsMobile } from "@gitinspect/ui/hooks/use-mobile";
import { focusLastFeedbackTrigger } from "@gitinspect/ui/lib/feedback-trigger";
import { cn } from "@gitinspect/ui/lib/utils";

type FeedbackTheme = "light" | "dark" | "system";

type FeedbackResponse = {
  issueNumber: number;
  issueUrl: string;
  ok: true;
};

type RouteMatchLike = {
  loaderData?: unknown;
  params: Record<string, string | undefined>;
  routeId: string;
};

type FeedbackErrors = {
  message?: string;
  sentiment?: string;
};

function isFeedbackTheme(value: string | undefined): value is FeedbackTheme {
  return value === "light" || value === "dark" || value === "system";
}

function isResolvedRepoSource(value: unknown): value is Pick<
  ResolvedRepoSource,
  "owner" | "repo"
> & {
  ref?: string;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.owner === "string" && typeof candidate.repo === "string";
}

function getDialogRepoSource(
  currentMatch: RouteMatchLike,
  session: SessionData | undefined,
): (Pick<ResolvedRepoSource, "owner" | "repo"> & { ref?: string }) | undefined {
  if (currentMatch.routeId === "/chat/$sessionId") {
    return session?.repoSource;
  }

  if (isResolvedRepoSource(currentMatch.loaderData)) {
    return currentMatch.loaderData;
  }

  return undefined;
}

function getRepoPath(pathname: string, repoRef: string | undefined): string | undefined {
  const intent = parseRepoRoutePath(pathname);

  if ((intent.type !== "tree-page" && intent.type !== "blob-page") || !repoRef) {
    return undefined;
  }

  if (intent.tail === repoRef) {
    return undefined;
  }

  if (intent.tail.startsWith(`${repoRef}/`)) {
    return intent.tail.slice(repoRef.length + 1) || undefined;
  }

  return undefined;
}

function collectFeedbackDiagnostics(input: {
  currentMatch: RouteMatchLike;
  pathname: string;
  session: SessionData | undefined;
  theme: string | undefined;
}): FeedbackPayload["diagnostics"] {
  const repoSource = getDialogRepoSource(input.currentMatch, input.session);
  const theme = isFeedbackTheme(input.theme) ? input.theme : undefined;

  return {
    language: navigator.language || undefined,
    model: input.session?.model,
    pathname: input.pathname,
    provider: input.session?.providerGroup ?? input.session?.provider,
    repo: repoSource
      ? {
          owner: repoSource.owner,
          path: getRepoPath(input.pathname, repoSource.ref),
          ref: repoSource.ref,
          repo: repoSource.repo,
        }
      : undefined,
    theme,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    viewport: {
      dpr: Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : undefined,
      height: window.innerHeight,
      width: window.innerWidth,
    },
  };
}

async function submitFeedback(payload: FeedbackPayload): Promise<FeedbackResponse> {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Feedback request failed");
  }

  const json: unknown = await response.json();

  if (typeof json !== "object" || json === null) {
    throw new Error("Feedback request failed");
  }

  const candidate = json as Record<string, unknown>;

  if (
    candidate.ok !== true ||
    typeof candidate.issueNumber !== "number" ||
    typeof candidate.issueUrl !== "string"
  ) {
    throw new Error("Feedback request failed");
  }

  return candidate as FeedbackResponse;
}

function useFeedbackOpenState() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const open = search.feedback === "open";

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (nextOpen === open) {
        return;
      }

      void navigate({
        search: (prev) => ({
          ...prev,
          feedback: nextOpen ? "open" : undefined,
        }),
        to: ".",
      });

      if (!nextOpen) {
        requestAnimationFrame(() => {
          focusLastFeedbackTrigger();
        });
      }
    },
    [navigate, open],
  );

  return { open, setOpen };
}

function SentimentButton(props: {
  currentSentiment: FeedbackSentiment | null;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onSelect: (sentiment: FeedbackSentiment) => void;
  selectedClassName?: string;
  sentiment: FeedbackSentiment;
  variant: "default" | "destructive" | "secondary";
}) {
  const selected = props.currentSentiment === props.sentiment;

  return (
    <Button
      aria-label={props.label}
      aria-pressed={selected}
      className={cn("h-10 flex-1", selected ? props.selectedClassName : undefined)}
      onClick={() => {
        props.onSelect(props.sentiment);
      }}
      type="button"
      variant={selected ? props.variant : "outline"}
    >
      <props.icon className="size-4" />
      <span>{props.label}</span>
    </Button>
  );
}

function FeedbackForm(props: {
  errors: FeedbackErrors;
  includeDiagnostics: boolean;
  isSubmitting: boolean;
  message: string;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  sentiment: FeedbackSentiment | null;
  setErrors: React.Dispatch<React.SetStateAction<FeedbackErrors>>;
  setIncludeDiagnostics: React.Dispatch<React.SetStateAction<boolean>>;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  setSentiment: React.Dispatch<React.SetStateAction<FeedbackSentiment | null>>;
  setWebsite: React.Dispatch<React.SetStateAction<string>>;
  website: string;
}) {
  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={props.onSubmit}>
      <div className="space-y-5 px-4 pb-4 md:px-0 md:pb-0">
        <div className="space-y-2">
          <Label htmlFor="feedback-message">Feedback</Label>
          <Textarea
            aria-invalid={props.errors.message ? true : undefined}
            autoFocus
            id="feedback-message"
            maxLength={2_000}
            onChange={(event) => {
              props.setMessage(event.currentTarget.value);
              props.setErrors((current) => ({ ...current, message: undefined }));
            }}
            placeholder="Tell us what went well, what felt confusing, or what broke."
            rows={6}
            value={props.message}
          />
          {props.errors.message ? (
            <p className="text-xs text-destructive">{props.errors.message}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>How did it feel?</Label>
          <div className="flex items-center gap-2">
            <SentimentButton
              currentSentiment={props.sentiment}
              icon={Icons.thumbsDown}
              label="Sad"
              onSelect={(value) => {
                props.setSentiment(value);
                props.setErrors((current) => ({ ...current, sentiment: undefined }));
              }}
              sentiment="sad"
              variant="destructive"
            />
            <SentimentButton
              currentSentiment={props.sentiment}
              icon={Icons.faceThinking}
              label="Neutral"
              onSelect={(value) => {
                props.setSentiment(value);
                props.setErrors((current) => ({ ...current, sentiment: undefined }));
              }}
              sentiment="neutral"
              variant="secondary"
            />
            <SentimentButton
              currentSentiment={props.sentiment}
              icon={Icons.thumbsUp}
              label="Happy"
              onSelect={(value) => {
                props.setSentiment(value);
                props.setErrors((current) => ({ ...current, sentiment: undefined }));
              }}
              selectedClassName="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 focus-visible:border-emerald-500/40 focus-visible:ring-emerald-500/20 dark:text-emerald-400 dark:hover:bg-emerald-500/30 dark:focus-visible:ring-emerald-500/40"
              sentiment="happy"
              variant="default"
            />
          </div>
          {props.errors.sentiment ? (
            <p className="text-xs text-destructive">{props.errors.sentiment}</p>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={props.includeDiagnostics}
              id="feedback-include-diagnostics"
              onCheckedChange={(checked) => {
                props.setIncludeDiagnostics(checked === true);
              }}
            />
            <div className="flex items-center gap-1.5">
              <Label htmlFor="feedback-include-diagnostics">
                Include technical details for debugging
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Show which technical details are included"
                    className="inline-flex size-4 items-center justify-center border border-border text-[10px] text-muted-foreground transition-colors hover:bg-muted"
                    type="button"
                  >
                    ?
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  user-agent, route, repo context, provider/model, viewport, theme, language,
                  timezone
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        <div aria-hidden className="hidden">
          <Label htmlFor="feedback-website">Website</Label>
          <Input
            autoComplete="off"
            id="feedback-website"
            name="website"
            onChange={(event) => {
              props.setWebsite(event.currentTarget.value);
            }}
            tabIndex={-1}
            value={props.website}
          />
        </div>
      </div>

      <div className="mt-2 flex flex-col-reverse gap-2 border-t px-4 pt-4 md:mt-5 md:flex-row md:justify-end md:px-0">
        <Button disabled={props.isSubmitting} type="submit">
          {props.isSubmitting ? "Sending…" : "Send feedback"}
        </Button>
      </div>
    </form>
  );
}

function FeedbackFormShell(props: {
  children: React.ReactNode;
  description: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer direction="bottom" onOpenChange={props.onOpenChange} open={props.open}>
        <DrawerContent className="max-h-[85dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{props.title}</DrawerTitle>
            <DrawerDescription>{props.description}</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 overflow-y-auto">{props.children}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog onOpenChange={props.onOpenChange} open={props.open}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{props.description}</DialogDescription>
        </DialogHeader>
        {props.children}
      </DialogContent>
    </Dialog>
  );
}

export function FeedbackDialog() {
  const { resolvedTheme, theme } = useTheme();
  const { open, setOpen } = useFeedbackOpenState();
  const currentMatch = useRouterState({
    select: (state) => state.matches[state.matches.length - 1],
  }) as RouteMatchLike;
  const sessionId =
    currentMatch.routeId === "/chat/$sessionId" ? currentMatch.params.sessionId : undefined;
  const session = useSelectedSessionSummary(sessionId);
  const [sentiment, setSentiment] = React.useState<FeedbackSentiment | null>(null);
  const [message, setMessage] = React.useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = React.useState(false);
  const [website, setWebsite] = React.useState("");
  const [errors, setErrors] = React.useState<FeedbackErrors>({});
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const nextErrors: FeedbackErrors = {};
      const trimmedMessage = message.trim();

      if (!sentiment) {
        nextErrors.sentiment = "Please choose a sentiment";
      }

      if (!trimmedMessage) {
        nextErrors.message = "Please enter your feedback";
      }

      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }

      const selectedSentiment = sentiment;

      if (!selectedSentiment) {
        return;
      }

      setIsSubmitting(true);

      try {
        const pathname = window.location.pathname;
        const result = await submitFeedback({
          diagnostics: includeDiagnostics
            ? collectFeedbackDiagnostics({
                currentMatch,
                pathname,
                session,
                theme: isFeedbackTheme(theme) ? theme : resolvedTheme,
              })
            : undefined,
          includeDiagnostics,
          message: trimmedMessage,
          sentiment: selectedSentiment,
          website,
        });

        toast.success("Thanks — feedback received", {
          action: {
            label: "Open in GitHub",
            onClick: () => {
              window.open(result.issueUrl, "_blank", "noopener,noreferrer");
            },
          },
        });
        setMessage("");
        setSentiment(null);
        setIncludeDiagnostics(false);
        setWebsite("");
        setErrors({});
        setOpen(false);
      } catch {
        toast.error("Could not send feedback right now");
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      currentMatch,
      includeDiagnostics,
      message,
      resolvedTheme,
      sentiment,
      session,
      setOpen,
      theme,
      website,
    ],
  );

  return (
    <FeedbackFormShell
      description="Tell us what went well, what felt confusing, or what broke."
      onOpenChange={setOpen}
      open={open}
      title="Send feedback"
    >
      <div className={cn("min-h-0", open ? "" : "pointer-events-none")}>
        <FeedbackForm
          errors={errors}
          includeDiagnostics={includeDiagnostics}
          isSubmitting={isSubmitting}
          message={message}
          onSubmit={handleSubmit}
          sentiment={sentiment}
          setErrors={setErrors}
          setIncludeDiagnostics={setIncludeDiagnostics}
          setMessage={setMessage}
          setSentiment={setSentiment}
          setWebsite={setWebsite}
          website={website}
        />
      </div>
    </FeedbackFormShell>
  );
}
