import { AppHeader as BaseAppHeader } from "@gitinspect/ui/components/app-header";

import { useSubscription } from "@/hooks/use-subscription";

export function AppHeader() {
  const { subscriptionState } = useSubscription();

  return <BaseAppHeader showGetPro={!subscriptionState?.isSubscribed} />;
}
