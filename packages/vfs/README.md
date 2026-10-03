# @gitinspect/vfs

An immutable, read-only GitHub repository snapshot for the browser. The Promise facade implements just-bash's `IFileSystem`; `readBytesEffect` exposes the Effect boundary.

```ts
import { GitHubFs } from "@gitinspect/vfs";
const fs = new GitHubFs({
  owner: "owner",
  repo: "repo",
  ref: { kind: "commit", sha: "a-full-commit-sha" },
  getToken: async () => optionalGitHubToken,
});
const text = await fs.readFile("README.md", abortSignal);
```

Branch and tag refs resolve once. `snapshotCommit()` returns that pinned SHA; `refresh()` clears caches without following a moving branch. HTTP effects have six permits and a 60-second request timeout. Requests stop on the supplied AbortSignal and surface structured `GitHubFsError` values. Rate limits are surfaced with retry metadata, without unbounded automatic retries; invalid-token anonymous fallback is retained for public repositories.

Complete recursive trees are indexed by path and parent. A truncated tree falls back to non-recursive trees and lazy directory loads. Blobs are fetched by SHA, shared across simultaneous readers, and cached as bytes. The last cancelled reader aborts the request; another active reader keeps it alive. Returned buffers are copies.

The default content cache is 50 MiB / 1,000 entries. Entries exceeding its budget are not cached. Files have a configurable 10 MiB read limit; API responses are bounded at 32 MiB. Repository runtimes use smaller per-snapshot caches. `stat` follows symlinks, `lstat` does not, `readlink` preserves targets, and cycles fail with `ELOOP`. Submodule traversal is explicitly unsupported. Every write, including timestamps, fails with `EROFS`.

The preceding implementation was adapted from [just-github](https://github.com/ThallesP/just-github); GitHub error and reference helpers remain compatible.
