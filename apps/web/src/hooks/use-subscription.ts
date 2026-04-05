import * as React from "react";
import { useCustomer } from "autumn-js/react";

import { authClient } from "@/lib/auth-client";

export type SubscriptionStatus = "active" | "canceled" | "inactive" | "past_due" | "scheduled";

export type SubscriptionState = {
  currentPeriodEnd: number | null;
  customerId: string | null;
  isSubscribed: boolean;
  plan: string | null;
  planId: string | null;
  planName: string | null;
  source: "purchase" | "subscription" | null;
  status: SubscriptionStatus;
};

const CUSTOMER_EXPAND_FIELDS = ["subscriptions.plan", "purchases.plan"];

function isPaidSubscription(autoEnable: boolean | undefined): boolean {
  return autoEnable !== true;
}

export function useSubscription() {
  const sessionState = authClient.useSession();
  const isSignedIn = Boolean(sessionState.data?.user?.id ?? sessionState.data?.session?.id);
  const sessionPending = Boolean((sessionState as { isPending?: boolean }).isPending);
  const customerState = useCustomer({
    expand: CUSTOMER_EXPAND_FIELDS,
    queryOptions: {
      enabled: isSignedIn,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
    },
  });

  const subscriptionState = React.useMemo<SubscriptionState | null>(() => {
    if (!isSignedIn) {
      return null;
    }

    const customer = customerState.data;
    const activeSubscription =
      customer?.subscriptions?.find(
        (subscription) =>
          !subscription.addOn &&
          (subscription.status === "active" || subscription.status === "scheduled"),
      ) ??
      customer?.subscriptions?.find((subscription) => !subscription.addOn) ??
      null;

    if (activeSubscription) {
      return {
        currentPeriodEnd: activeSubscription.currentPeriodEnd,
        customerId: customer?.id ?? null,
        isSubscribed: isPaidSubscription(activeSubscription.autoEnable),
        plan: activeSubscription.planId,
        planId: activeSubscription.planId,
        planName: activeSubscription.plan?.name ?? activeSubscription.planId,
        source: "subscription",
        status: activeSubscription.pastDue
          ? "past_due"
          : activeSubscription.canceledAt
            ? "canceled"
            : activeSubscription.status === "scheduled"
              ? "scheduled"
              : "active",
      };
    }

    const now = Date.now();
    const activePurchase =
      customer?.purchases?.find(
        (purchase) => purchase.expiresAt === null || purchase.expiresAt > now,
      ) ?? null;

    if (activePurchase) {
      return {
        currentPeriodEnd: activePurchase.expiresAt,
        customerId: customer?.id ?? null,
        isSubscribed: true,
        plan: activePurchase.planId,
        planId: activePurchase.planId,
        planName: activePurchase.plan?.name ?? activePurchase.planId,
        source: "purchase",
        status: "active",
      };
    }

    return {
      currentPeriodEnd: null,
      customerId: customer?.id ?? null,
      isSubscribed: false,
      plan: null,
      planId: null,
      planName: null,
      source: null,
      status: "inactive",
    };
  }, [customerState.data, isSignedIn]);

  return {
    attach: customerState.attach,
    customer: customerState.data,
    error: customerState.error,
    isPending: sessionPending || (isSignedIn && customerState.isLoading),
    isSignedIn,
    openCustomerPortal: customerState.openCustomerPortal,
    refetch: customerState.refetch,
    refresh: async () => {
      if (!isSignedIn) {
        return;
      }

      await customerState.refetch();
    },
    subscriptionState,
    subscriptionStatus: subscriptionState,
  };
}
