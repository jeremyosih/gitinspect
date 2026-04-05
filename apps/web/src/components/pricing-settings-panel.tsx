import * as React from "react";
import { useListPlans } from "autumn-js/react";
import { Check, CreditCard, Crown, Loader2, LogIn, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { useSubscription } from "@/hooks/use-subscription";
import { openAuthDialog } from "@/store/auth-store";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@gitinspect/ui/components/alert";
import { Badge } from "@gitinspect/ui/components/badge";
import { Button } from "@gitinspect/ui/components/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@gitinspect/ui/components/card";
import { cn } from "@gitinspect/ui/lib/utils";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

function formatPlanPrice(plan: NonNullable<ReturnType<typeof useListPlans>["data"]>[number]) {
  if (plan.price) {
    return {
      amount: currencyFormatter.format(plan.price.amount),
      interval: plan.price.interval === "one_off" ? "one-time" : `/${plan.price.interval}`,
    };
  }

  const topUpAmountMatch = plan.items
    .map((item) => item.display?.primaryText ?? "")
    .join(" ")
    .match(/\$\s*\d+/i);

  if (topUpAmountMatch) {
    return {
      amount: topUpAmountMatch[0].replace(/\s+/g, ""),
      interval: null,
    };
  }

  return {
    amount: "Free",
    interval: null,
  };
}

function getPlanBadgeLabel(plan: NonNullable<ReturnType<typeof useListPlans>["data"]>[number]) {
  const price = formatPlanPrice(plan);

  return price.amount === "Free" ? "Free" : price.amount;
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getItemPrimaryText(
  item: NonNullable<ReturnType<typeof useListPlans>["data"]>[number]["items"][number],
) {
  if (item.display?.primaryText) {
    return item.display.primaryText;
  }

  const featureName = item.feature?.name ?? humanizeIdentifier(item.featureId);

  if (item.unlimited) {
    return `Unlimited ${featureName}`;
  }

  if (item.included > 0) {
    return `${item.included} ${featureName}`;
  }

  return featureName;
}

function isYearlyPlan(plan: NonNullable<ReturnType<typeof useListPlans>["data"]>[number]) {
  return plan.price?.interval === "year" || /yearly|annual/i.test(plan.name);
}

function normalizePlanItemPrimaryText(
  plan: NonNullable<ReturnType<typeof useListPlans>["data"]>[number],
  primaryText: string,
) {
  const trimmedPrimaryText = primaryText.trim();

  if (!plan.price && /^5\s+messages$/i.test(trimmedPrimaryText)) {
    return "5 Messages / day";
  }

  if (plan.price?.interval === "month" && /^500\s+messages$/i.test(trimmedPrimaryText)) {
    return "500 Messages / month";
  }

  return primaryText;
}

function getPlanItems(plan: NonNullable<ReturnType<typeof useListPlans>["data"]>[number]) {
  const items = plan.items
    .map((item) => ({
      featureId: item.featureId,
      primaryText: normalizePlanItemPrimaryText(plan, getItemPrimaryText(item)),
    }))
    .filter((item) => {
      if (!isYearlyPlan(plan)) {
        return true;
      }

      return !/^500\s+messages$/i.test(item.primaryText.trim());
    });

  if (!isYearlyPlan(plan)) {
    return items;
  }

  if (!items.some((item) => /500\s+messages\s*\/\s*month/i.test(item.primaryText))) {
    items.unshift({
      featureId: "yearly-monthly-messages",
      primaryText: "500 Messages / month",
    });
  }

  return items;
}

function formatPeriodEnd(timestamp: number | null | undefined): string | null {
  if (!timestamp) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(timestamp);
}

export function PricingSettingsPanel() {
  const [pendingAction, setPendingAction] = React.useState<string | null>(null);
  const plansQuery = useListPlans({
    includeArchived: false,
    queryOptions: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
    },
  });
  const {
    attach,
    error: customerError,
    isPending: subscriptionPending,
    isSignedIn,
    openCustomerPortal,
    subscriptionState,
  } = useSubscription();

  const plans = React.useMemo(() => {
    return [...(plansQuery.data ?? [])].sort((left, right) => {
      const leftAmount = left.price?.amount ?? 0;
      const rightAmount = right.price?.amount ?? 0;

      if (leftAmount !== rightAmount) {
        return leftAmount - rightAmount;
      }

      return left.name.localeCompare(right.name);
    });
  }, [plansQuery.data]);

  const currentPlanId = subscriptionState?.planId ?? null;
  const currentPeriodEnd = formatPeriodEnd(subscriptionState?.currentPeriodEnd);
  const combinedError = customerError ?? plansQuery.error ?? null;
  const combinedErrorMessage = combinedError?.message ?? null;
  const isAutumnNotConfigured = combinedErrorMessage?.includes("Autumn is not configured") ?? false;

  const handleSelectPlan = React.useCallback(
    async (planId: string) => {
      if (!isSignedIn) {
        openAuthDialog({ mode: "github-only", reason: "settings" });
        return;
      }

      try {
        setPendingAction(`plan:${planId}`);
        await attach({
          planId,
          redirectMode: "always",
          successUrl: window.location.href,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not open checkout.");
      } finally {
        setPendingAction(null);
      }
    },
    [attach, isSignedIn],
  );

  const handleOpenBillingPortal = React.useCallback(async () => {
    try {
      setPendingAction("portal");
      await openCustomerPortal({
        returnUrl: window.location.href,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the billing portal.");
    } finally {
      setPendingAction(null);
    }
  }, [openCustomerPortal]);

  return (
    <div className="space-y-5">
      {isAutumnNotConfigured ? (
        <Alert>
          <Crown className="mt-0.5 size-4" />
          <AlertTitle>Billing still needs to be initialized</AlertTitle>
          <AlertDescription>
            Finish the billing setup to load plans here. Run{" "}
            <code className="bg-muted px-1 py-0.5">npx atmn init</code> to generate
            <code className="bg-muted ml-1 px-1 py-0.5">autumn.config.ts</code> and sync your
            billing config.
          </AlertDescription>
        </Alert>
      ) : null}

      {!isSignedIn ? (
        <Alert>
          <LogIn className="mt-0.5 size-4" />
          <AlertTitle>Sign in to manage billing</AlertTitle>
          <AlertDescription>
            Sign in with GitHub to choose a plan and manage billing.
          </AlertDescription>
          <AlertAction>
            <Button
              onClick={() => openAuthDialog({ mode: "github-only", reason: "settings" })}
              size="sm"
              variant="outline"
            >
              <LogIn className="size-3.5" />
              Sign in
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {isSignedIn && subscriptionState ? (
        <Alert>
          <Crown className="mt-0.5 size-4" />
          <AlertTitle>
            {subscriptionState.planName
              ? `Current plan: ${subscriptionState.planName}`
              : "No active paid plan yet"}
          </AlertTitle>
          <AlertDescription>
            {subscriptionState.planName
              ? currentPeriodEnd
                ? `Status: ${subscriptionState.status.replace(/_/g, " ")} • Current period ends ${currentPeriodEnd}.`
                : `Status: ${subscriptionState.status.replace(/_/g, " ")}.`
              : "Pick a plan below to get started."}
          </AlertDescription>
          {subscriptionState.isSubscribed ? (
            <AlertAction>
              <Button
                disabled={pendingAction === "portal"}
                onClick={() => void handleOpenBillingPortal()}
                size="sm"
                variant="outline"
              >
                {pendingAction === "portal" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CreditCard className="size-3.5" />
                )}
                Manage billing
              </Button>
            </AlertAction>
          ) : null}
        </Alert>
      ) : null}

      {combinedError && !isAutumnNotConfigured ? (
        <Alert variant="destructive">
          <CreditCard className="mt-0.5 size-4" />
          <AlertTitle>Could not load billing data</AlertTitle>
          <AlertDescription>{combinedErrorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {plansQuery.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <Card key={index} className="min-h-[18rem] animate-pulse">
              <CardHeader>
                <CardTitle className="h-4 w-24 rounded-none bg-muted" />
                <CardDescription className="h-3 w-40 rounded-none bg-muted" />
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="h-8 w-28 rounded-none bg-muted" />
                <div className="h-3 w-full rounded-none bg-muted" />
                <div className="h-3 w-5/6 rounded-none bg-muted" />
                <div className="h-3 w-4/6 rounded-none bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {!plansQuery.isLoading && plans.length === 0 && !combinedError ? (
        <Alert>
          <Sparkles className="mt-0.5 size-4" />
          <AlertTitle>No plans found yet</AlertTitle>
          <AlertDescription>Available plans will show up here automatically.</AlertDescription>
        </Alert>
      ) : null}

      {plans.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {plans.map((plan) => {
            const price = formatPlanPrice(plan);
            const isCurrentPlan = currentPlanId === plan.id;
            const isPendingPlan = pendingAction === `plan:${plan.id}`;
            const actionLabel = isCurrentPlan
              ? "Current plan"
              : !isSignedIn
                ? "Sign in to choose"
                : subscriptionState?.isSubscribed
                  ? "Switch plan"
                  : "Choose plan";

            return (
              <Card
                className={cn(
                  "border border-foreground/10",
                  isCurrentPlan && "ring-2 ring-foreground/25",
                  !isCurrentPlan && plan.price && "bg-gradient-to-b from-card to-muted/15",
                )}
                key={plan.id}
              >
                <CardHeader>
                  <CardAction className="flex flex-wrap items-center gap-1">
                    {isCurrentPlan ? <Badge>Current</Badge> : null}
                    <Badge variant="outline">{getPlanBadgeLabel(plan)}</Badge>
                    {plan.freeTrial ? (
                      <Badge variant="secondary">
                        <Sparkles className="size-3" />
                        Trial
                      </Badge>
                    ) : null}
                  </CardAction>
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex items-end gap-2">
                      <span className="font-heading text-3xl leading-none">{price.amount}</span>
                      {price.interval ? (
                        <span className="pb-0.5 text-muted-foreground text-xs">
                          {price.interval}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <ul className="space-y-2">
                    {getPlanItems(plan).map((item) => (
                      <li className="flex items-start gap-2" key={`${plan.id}:${item.featureId}`}>
                        <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" />
                        <div className="min-w-0 text-xs font-medium">{item.primaryText}</div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter className="flex-col items-stretch gap-2">
                  <Button
                    className="w-full"
                    disabled={isCurrentPlan || pendingAction === "portal" || isPendingPlan}
                    onClick={() => void handleSelectPlan(plan.id)}
                    size="lg"
                    variant={isCurrentPlan ? "secondary" : "default"}
                  >
                    {isPendingPlan ? <Loader2 className="size-4 animate-spin" /> : null}
                    {actionLabel}
                  </Button>
                  {isCurrentPlan && subscriptionState?.isSubscribed ? (
                    <Button
                      className="w-full"
                      disabled={pendingAction === "portal"}
                      onClick={() => void handleOpenBillingPortal()}
                      size="lg"
                      variant="outline"
                    >
                      {pendingAction === "portal" ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CreditCard className="size-4" />
                      )}
                      Manage billing
                    </Button>
                  ) : null}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      ) : null}

      {subscriptionPending && !plansQuery.isLoading ? (
        <div className="text-[11px] text-muted-foreground">Refreshing your billing state…</div>
      ) : null}
    </div>
  );
}
