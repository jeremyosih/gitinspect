import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { loadPublicSessionSnapshot } from "@gitinspect/pi/lib/public-share-client";
import { PublicSharePage } from "@/components/public-share-page";

const shareQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

export const Route = createFileRoute("/share/$sessionId")({
  component: ShareSessionRoute,
  loader: async ({ params }) => {
    try {
      return (await loadPublicSessionSnapshot(params.sessionId)) ?? null;
    } catch {
      return null;
    }
  },
  head: () => ({
    meta: [
      {
        title: "Shared transcript • gitinspect",
      },
      {
        content: "noindex,nofollow",
        name: "robots",
      },
    ],
  }),
});

function ShareSessionRoute() {
  const { sessionId } = Route.useParams();
  const initialSnapshot = Route.useLoaderData();

  return (
    <QueryClientProvider client={shareQueryClient}>
      <PublicSharePage initialSnapshot={initialSnapshot ?? undefined} sessionId={sessionId} />
    </QueryClientProvider>
  );
}
