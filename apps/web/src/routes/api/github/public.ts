import { createFileRoute } from "@tanstack/react-router";
import { env } from "@gitinspect/env/server";

type PublicRepoResponse = {
  default_branch: string;
  language: string | null;
  private: boolean;
  stargazers_count: number;
};

function isPublicRepoResponse(value: unknown): value is PublicRepoResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.default_branch === "string" &&
    (typeof candidate.language === "string" || candidate.language === null) &&
    typeof candidate.private === "boolean" &&
    typeof candidate.stargazers_count === "number"
  );
}

function buildCacheHeaders(): Headers {
  const headers = new Headers();
  headers.set("cache-control", "public, max-age=300, s-maxage=300, stale-while-revalidate=3600");
  return headers;
}

export const Route = createFileRoute("/api/github/public")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const owner = url.searchParams.get("owner")?.trim();
        const repo = url.searchParams.get("repo")?.trim();

        if (!owner || !repo) {
          return Response.json({ error: "owner and repo are required" }, { status: 400 });
        }

        const upstreamUrl = new URL(`https://api.github.com/repos/${owner}/${repo}`);
        upstreamUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
        upstreamUrl.searchParams.set("client_secret", env.GITHUB_CLIENT_SECRET);

        const response = await fetch(upstreamUrl, {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });

        if (!response.ok) {
          return Response.json(
            { error: "Could not load public GitHub metadata" },
            {
              headers: buildCacheHeaders(),
              status: response.status,
            },
          );
        }

        const json: unknown = await response.json();

        if (!isPublicRepoResponse(json) || json.private) {
          return Response.json(
            { error: "Repository metadata is unavailable" },
            {
              headers: buildCacheHeaders(),
              status: 404,
            },
          );
        }

        return Response.json(
          {
            default_branch: json.default_branch,
            language: json.language,
            stargazers_count: json.stargazers_count,
          },
          {
            headers: buildCacheHeaders(),
          },
        );
      },
    },
  },
});
