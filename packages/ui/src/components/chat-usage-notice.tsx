import * as React from "react";

type MessageBalance = {
  breakdown?: Array<{
    reset?: {
      interval: string;
    } | null;
  }>;
  nextResetAt: number | null;
  remaining: number;
};

const relativeTimeFormat = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

function formatMessageCount(value: number): string {
  return `${value} ${value === 1 ? "message" : "messages"}`;
}

function getResetInterval(balance: MessageBalance | null | undefined): string | null {
  const intervals = balance?.breakdown
    ?.map((breakdown) => breakdown.reset?.interval)
    .filter(
      (interval): interval is string => typeof interval === "string" && interval !== "multiple",
    );

  if (!intervals || intervals.length === 0) {
    return null;
  }

  return new Set(intervals).size === 1 ? intervals[0] : null;
}

function getWindowLabel(balance: MessageBalance | null | undefined): string {
  const interval = getResetInterval(balance);

  switch (interval) {
    case "hour":
      return "this hour";
    case "day":
      return "today";
    case "week":
      return "this week";
    case "month":
      return "this month";
    case "year":
      return "this year";
    default:
      return "before reset";
  }
}

function formatRetryDelay(nextResetAt: number | null | undefined): string | null {
  if (!nextResetAt || !Number.isFinite(nextResetAt)) {
    return null;
  }

  const diffMs = nextResetAt - Date.now();

  if (diffMs <= 0) {
    return "soon";
  }

  if (diffMs < 60_000) {
    return "in less than a minute";
  }

  const units = [
    { max: 3_600_000, ms: 60_000, unit: "minute" as const },
    { max: 86_400_000, ms: 3_600_000, unit: "hour" as const },
    { max: 604_800_000, ms: 86_400_000, unit: "day" as const },
    { max: 2_592_000_000, ms: 604_800_000, unit: "week" as const },
    { max: Number.POSITIVE_INFINITY, ms: 2_592_000_000, unit: "month" as const },
  ];

  const selected = units.find((candidate) => diffMs < candidate.max) ?? units[units.length - 1];
  return relativeTimeFormat.format(Math.ceil(diffMs / selected.ms), selected.unit);
}

function InlineAction(props: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      className="inline font-medium text-foreground underline underline-offset-4 transition-colors hover:text-foreground/80"
      onClick={props.onClick}
      type="button"
    >
      {props.children}
    </button>
  );
}

export function ChatUsageNotice(props: {
  balance?: MessageBalance | null;
  error?: Error | null;
  isLoading: boolean;
  isVisible: boolean;
  onSignIn: () => void;
  onUpgrade: () => void;
  session: "signed-in" | "signed-out";
}) {
  if (!props.isVisible) {
    return null;
  }

  if (props.session !== "signed-in") {
    return (
      <p className="pt-2 text-xs text-muted-foreground">
        <InlineAction onClick={props.onSignIn}>Sign in</InlineAction> to access our free models with
        daily limits.
      </p>
    );
  }

  if (props.isLoading && !props.balance) {
    return <p className="pt-2 text-xs text-muted-foreground">Checking message limits…</p>;
  }

  if (props.error && !props.balance) {
    return (
      <p className="pt-2 text-xs text-muted-foreground">
        Couldn&apos;t load message limits right now.
      </p>
    );
  }

  const remaining = Math.max(0, Math.floor(props.balance?.remaining ?? 0));

  if (remaining > 0) {
    return (
      <p className="pt-2 text-xs text-muted-foreground">
        {formatMessageCount(remaining)} remaining {getWindowLabel(props.balance)}.
      </p>
    );
  }

  const retryDelay = formatRetryDelay(props.balance?.nextResetAt ?? null);

  return (
    <p className="pt-2 text-xs text-muted-foreground">
      Out of messages.
      {retryDelay ? (
        <>
          {` Try again ${retryDelay} or `}
          <InlineAction onClick={props.onUpgrade}>upgrade</InlineAction>.
        </>
      ) : (
        <>
          {" "}
          <InlineAction onClick={props.onUpgrade}>Upgrade</InlineAction> to keep chatting.
        </>
      )}
    </p>
  );
}
