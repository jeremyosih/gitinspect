import type { RepositoryRow } from "@gitinspect/db";

/** Curated repos for suggested pickers (landing, combobox when no recents). */
export const SUGGESTED_REPOS: ReadonlyArray<
  Pick<RepositoryRow, "owner" | "ref" | "refOrigin" | "repo">
> = [
  { owner: "imputnet", repo: "helium", ref: "main", refOrigin: "default" },
  { owner: "pierrecomputer", repo: "pierre", ref: "main", refOrigin: "default" },
  { owner: "jeremyosih", repo: "gitinspect", ref: "main", refOrigin: "default" },
  { owner: "alibaba", repo: "OpenSandbox", ref: "main", refOrigin: "default" },
  { owner: "coderamp-labs", repo: "gitingest", ref: "main", refOrigin: "default" },
  { owner: "twentyhq", repo: "twenty", ref: "main", refOrigin: "default" },
  { owner: "badlogic", repo: "pi-mono", ref: "main", refOrigin: "default" },
  { owner: "openclaw", repo: "openclaw", ref: "main", refOrigin: "default" },
  { owner: "oven-sh", repo: "bun", ref: "main", refOrigin: "default" },
  { owner: "vercel-labs", repo: "just-bash", ref: "main", refOrigin: "default" },
  { owner: "Effect-TS", repo: "effect", ref: "main", refOrigin: "default" },
  { owner: "rocicorp", repo: "mono", ref: "main", refOrigin: "default" },
  { owner: "zml", repo: "zml", ref: "main", refOrigin: "default" },
  { owner: "anomalyco", repo: "opencode", ref: "dev", refOrigin: "explicit" },
  { owner: "durable-streams", repo: "durable-streams", ref: "main", refOrigin: "default" },
  { owner: "rivet-dev", repo: "rivet", ref: "main", refOrigin: "default" },
  { owner: "better-auth", repo: "better-auth", ref: "main", refOrigin: "default" },
  { owner: "RhysSullivan", repo: "executor", ref: "main", refOrigin: "default" },
  { owner: "chenglou", repo: "pretext", ref: "main", refOrigin: "default" },
];
