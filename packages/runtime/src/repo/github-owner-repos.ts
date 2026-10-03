import { githubApiFetch } from "@gitinspect/runtime/repo/github-fetch";

export type GitHubAccountType = "Organization" | "User";

type GitHubUserPayload = {
  type?: string;
};

type GitHubRepoListItem = {
  name: string;
  stargazers_count?: number;
};

function parseRepoNamesSortedByStars(json: unknown): string[] {
  if (!Array.isArray(json)) {
    return [];
  }

  const rows: { name: string; stars: number }[] = [];
  for (const item of json) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as GitHubRepoListItem).name === "string"
    ) {
      const raw = (item as GitHubRepoListItem).stargazers_count;
      const stars = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      rows.push({ name: (item as GitHubRepoListItem).name, stars });
    }
  }

  rows.sort((a, b) => {
    if (b.stars !== a.stars) {
      return b.stars - a.stars;
    }
    return a.name.localeCompare(b.name);
  });

  return rows.map((r) => r.name);
}

/**
 * Resolves public repositories for a GitHub user or organization login (for org landing UX).
 */
export async function fetchPublicReposForLogin(
  login: string,
  options?: { signal?: AbortSignal },
): Promise<
  | { status: "ok"; accountType: GitHubAccountType; repos: string[] }
  | { status: "not_found" }
  | { status: "error"; httpStatus: number }
> {
  const trimmed = login.trim();
  if (!trimmed) {
    return { status: "not_found" };
  }

  const enc = encodeURIComponent(trimmed);
  const profileRes = await githubApiFetch(`/users/${enc}`, {
    access: "public",
    signal: options?.signal,
  });

  if (profileRes.status === 404) {
    return { status: "not_found" };
  }

  if (!profileRes.ok) {
    return { status: "error", httpStatus: profileRes.status };
  }

  const profile = (await profileRes.json()) as GitHubUserPayload;
  const accountType: GitHubAccountType = profile.type === "Organization" ? "Organization" : "User";

  const listPath =
    accountType === "Organization"
      ? `/orgs/${enc}/repos?per_page=100&sort=updated&type=public`
      : `/users/${enc}/repos?per_page=100&sort=updated`;

  const listRes = await githubApiFetch(listPath, {
    access: "public",
    signal: options?.signal,
  });

  if (!listRes.ok) {
    return { status: "error", httpStatus: listRes.status };
  }

  const listJson: unknown = await listRes.json();
  const repos = parseRepoNamesSortedByStars(listJson);

  return { status: "ok", accountType, repos };
}
