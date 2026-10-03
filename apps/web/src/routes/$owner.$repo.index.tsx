import { createFileRoute } from "@tanstack/react-router";
import { resolveRepoIntent } from "@gitinspect/runtime/repo/ref-resolver";
import { Chat } from "@gitinspect/ui/components/chat";
import { toResolvedRepoSource } from "@gitinspect/runtime/repo/path-intent";
import { githubRepoUrl } from "@gitinspect/runtime/repo/url";

type RepoSearch = {
  q?: string;
};

export const Route = createFileRoute("/$owner/$repo/")({
  loader: async ({ params }) =>
    toResolvedRepoSource(
      await resolveRepoIntent({
        owner: params.owner,
        repo: params.repo,
        type: "repo-root",
      }),
    ),
  validateSearch: (search: RepoSearch) => ({
    q: typeof search.q === "string" && search.q.trim().length > 0 ? search.q : undefined,
  }),
  component: RepoChatRoute,
});

function RepoChatRoute() {
  const params = Route.useParams();
  const repoSource = Route.useLoaderData();

  return <Chat repoSource={repoSource} sourceUrl={githubRepoUrl(params.owner, params.repo)} />;
}
