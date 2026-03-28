import type { RepositoryRow } from "@/types/storage"

/** Curated repos for suggested pickers (landing, combobox when no recents). */
export const SUGGESTED_REPOS: ReadonlyArray<
  Pick<RepositoryRow, "owner" | "repo" | "ref">
> = [
  { owner: "imputnet", repo: "helium", ref: "main" },
  { owner: "pierrecomputer", repo: "pierre", ref: "main" },
  { owner: "jeremyosih", repo: "gitinspect", ref: "main" },
  { owner: "alibaba", repo: "OpenSandbox", ref: "main" },
  { owner: "coderamp-labs", repo: "gitingest", ref: "main" },
  { owner: "twentyhq", repo: "twenty", ref: "main" },
  { owner: "badlogic", repo: "pi-mono", ref: "main" },
  { owner: "openclaw", repo: "openclaw", ref: "main" },
  { owner: "oven-sh", repo: "bun", ref: "main" },
  { owner: "vercel-labs", repo: "just-bash", ref: "main" },
  { owner: "Effect-TS", repo: "effect", ref: "main" },
  { owner: "rocicorp", repo: "mono", ref: "main" },
  { owner: "zml", repo: "zml", ref: "main" },
  { owner: "anomalyco", repo: "opencode", ref: "dev" },
  { owner: "durable-streams", repo: "durable-streams", ref: "main" },
  { owner: "rivet-dev", repo: "rivet", ref: "main" },
  { owner: "better-auth", repo: "better-auth", ref: "main" },
  { owner: "RhysSullivan", repo: "executor", ref: "main" },
]
