import { authClient } from "@/lib/auth-client";

export type SubscriptionState = {
  plan: "free";
  status: "inactive";
};

const DEFAULT_SUBSCRIPTION_STATE: SubscriptionState = {
  plan: "free",
  status: "inactive",
};

export function useSubscription() {
  const sessionState = authClient.useSession();
  const isSignedIn = Boolean(sessionState.data?.session.id);

  return {
    isPending: false,
    isSignedIn,
    refresh: async () => {},
    subscriptionState: isSignedIn ? DEFAULT_SUBSCRIPTION_STATE : null,
  };
}
