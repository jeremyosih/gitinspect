import type { ResolvedRepoSource } from "@gitinspect/db";

type HeaderRepo = Pick<ResolvedRepoSource, "owner" | "repo"> & {
  ref?: string;
};

let currentRepo: HeaderRepo | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setPublicShareHeaderRepo(repo: HeaderRepo | undefined): void {
  currentRepo = repo;
  emit();
}

export function subscribePublicShareHeaderRepo(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPublicShareHeaderRepo(): HeaderRepo | undefined {
  return currentRepo;
}
