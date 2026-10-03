import { createFileRoute, redirect } from "@tanstack/react-router";
import { isReservedRootOwnerSegment } from "@gitinspect/runtime/repo/path-parser";
import { OrgRepoPicker } from "@gitinspect/ui/components/org-repo-picker";

export const Route = createFileRoute("/$owner/")({
  beforeLoad: ({ params }) => {
    if (isReservedRootOwnerSegment(params.owner)) {
      throw redirect({
        search: {
          tab: undefined,
          feedback: undefined,
          settings: undefined,
          sidebar: undefined,
        },
        to: "/",
      });
    }
  },
  component: OwnerLandingRoute,
});

function OwnerLandingRoute() {
  const { owner } = Route.useParams();
  return <OrgRepoPicker ownerLogin={owner} />;
}
