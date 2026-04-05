import { AppSidebar as BaseAppSidebar } from "@gitinspect/ui/components/app-sidebar";

import { useSubscription } from "@/hooks/use-subscription";

export function AppSidebar() {
  const { subscriptionState } = useSubscription();

  return <BaseAppSidebar showGetPro={!subscriptionState?.isSubscribed} />;
}
