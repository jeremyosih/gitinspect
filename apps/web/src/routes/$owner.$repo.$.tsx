import { createFileRoute } from "@tanstack/react-router";
import { resolveRepoIntent } from "@gitinspect/runtime/repo/ref-resolver";
import { Chat } from "@gitinspect/ui/components/chat";
import { parseRepoRoutePath } from "@gitinspect/runtime/repo/path-parser";
import { toResolvedRepoSource } from "@gitinspect/runtime/repo/path-intent";
import { githubRepoPathUrl } from "@gitinspect/runtime/repo/url";

type RepoSplatSearch = {
  q?: string;
};

export const Route = createFileRoute("/$owner/$repo/$")({
  loader: async ({ params }) => {
    const decodedSplat = decodePathFragment(params._splat ?? "");
    const intent = parseRepoRoutePath(`/${params.owner}/${params.repo}/${decodedSplat}`);
    if (intent.type === "invalid") {
      return toResolvedRepoSource(await resolveRepoIntent(intent));
    }

    return toResolvedRepoSource(await resolveRepoIntent(intent));
  },
  validateSearch: (search: RepoSplatSearch) => ({
    q: typeof search.q === "string" && search.q.trim().length > 0 ? search.q : undefined,
  }),
  component: RepoChatRoute,
});

function RepoChatRoute() {
  const params = Route.useParams();
  const repoSource = Route.useLoaderData();
  const decodedSplat = decodePathFragment(params._splat ?? "");

  return (
    <Chat
      repoSource={repoSource}
      sourceUrl={githubRepoPathUrl(params.owner, params.repo, decodedSplat)}
    />
  );
}

function decodePathFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
