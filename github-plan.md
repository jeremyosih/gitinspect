# GitHub ref-loading fix plan

## Error

**User-visible symptom**

- Opening a GitHub-style branch URL like `/zml/zml/tree/hugomano/custom_call` can fail with:
  - `Cannot read properties of undefined (reading 'sha')`
  - followed by secondary repo-probing errors like missing `package.json`

**Primary root cause**

- `just-github/src/github-client.ts` assumes the commit payload shape is `commit.tree.sha` at the top level.
- The real GitHub REST payload is `{ sha, commit: { tree: { sha }}}`.
- So `GitHubFs.fetchTree()` crashes whenever it tries to read `commit.tree.sha`.

**Why the `package.json` error is secondary**

- After tree loading fails, the agent/tooling falls back to probing common files.
- On non-Node repos, that can surface harmless follow-on errors like missing `package.json`.

## Route audit

| Supported route/ref kind                                                                | Current status                     | Why                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/owner/repo` (default branch)                                                          | **Broken once tree access starts** | Resolves the default branch, but `GitHubFs.fetchTree()` crashes.                                                                                                                           |
| `/owner/repo/<branch>` (single-segment branch)                                          | **Broken once tree access starts** | Branch resolution works, tree loading crashes.                                                                                                                                             |
| `/owner/repo/<sha>` and `/owner/repo/commit/<sha>`                                      | **Broken once tree access starts** | Commit resolution works, tree loading crashes.                                                                                                                                             |
| `/owner/repo/issues/...` and other fallback pages                                       | **Broken once tree access starts** | They fall back to default branch, which hits the same tree-loading bug.                                                                                                                    |
| `/owner/repo/tree/<exact-branch-ref>` or `/blob/<exact-branch-ref>` with **no subpath** | **Broken once tree access starts** | Exact branch resolution can work, but tree loading still crashes.                                                                                                                          |
| `/owner/repo/tree/<branch>/<path>` and `/blob/<branch>/<path>`                          | **Broken during ref resolution**   | `resolveTailAsRef()` probes candidates with `/commits/heads/...`; GitHub returns **422**, not the mocked **404** the tests expect, so the scan aborts before it can shorten the candidate. |
| Tag routes (`/<tag>`, `/tree/<tag>`, `/blob/<tag>`)                                     | **Broken during ref resolution**   | `lookupTag()` uses `/commits/tags/<name>`, which GitHub rejects for normal tags.                                                                                                           |
| Tree/blob routes that use a commit SHA as the ref prefix                                | **Broken during ref resolution**   | The branch/tag probes throw **422** before the commit fallback runs.                                                                                                                       |
| Internal canonical paths for slash refs (for example `/owner/repo/feature/foo`)         | **Do not round-trip**              | `repoSourceToPath()` emits `/owner/repo/feature/foo`, but `parseRepoRoutePath()` treats that as invalid unless the third segment is `tree`, `blob`, or `commit`.                           |

## Correct fix

### 1) Fix tree loading in `just-github`

- Update `just-github/src/github-client.ts` so the commit payload matches the real GitHub shape:
  - use `commit.commit.tree.sha`
  - not `commit.tree.sha`
- This fixes the immediate crash for any route that successfully resolves to a branch or commit.

### 2) Stop using the commits endpoint as a branch/tag existence probe

- In `packages/pi/src/repo/ref-resolver.ts`, replace branch/tag probing based on:
  - `/repos/{owner}/{repo}/commits/heads/{candidate}`
  - `/repos/{owner}/{repo}/commits/tags/{candidate}`
- Use the Git refs API instead:
  - `/repos/{owner}/{repo}/git/ref/heads/{candidate}`
  - `/repos/{owner}/{repo}/git/ref/tags/{candidate}`
- Keep `/repos/{owner}/{repo}/commits/{sha}` only for validating full commit SHAs.

Why this is the correct fix:

- Git refs endpoints cleanly distinguish branches vs tags.
- They support slash refs naturally.
- They avoid the real-world `422 No commit found for SHA` behavior that currently breaks candidate scanning.

### 3) Make canonical app URLs round-trip

- Update `packages/pi/src/repo/url.ts` so explicit refs use GitHub-shaped internal paths:
  - default branch → `/owner/repo`
  - explicit branch/tag → `/owner/repo/tree/<ref>`
  - explicit commit → `/owner/repo/commit/<sha>`
- This makes `repoSourceToPath()` compatible with `parseRepoRoutePath()` for slash refs.
- **Decision:** Match GitHub/gitingest strictly for explicit refs, even at the cost of backward compatibility.
- **Implication:** Stop using shorthand explicit-ref app paths like `/owner/repo/<ref>` as canonical output paths.

### 4) Keep tag support correct, not accidentally downgraded

- Normal commit-pointing tags should resolve and browse like branches.
- **Decision:** Keep annotated tags that target trees/blobs explicitly unsupported in v0.
- Preserve a clear explicit error for those objects instead of silently falling back or expanding scope now.

## Tests to add or update

Update mocks so they match the real GitHub API instead of the current simplified shapes/status codes.

- `just-github/tests/github-fs.test.ts`
- `tests/lib/github-fs.test.ts`
  - commit payload should look like `{ sha, commit: { tree: { sha }}}`
- `tests/ref-resolver.test.ts`
  - missing branch/tag probe candidates should model real **422** behavior where applicable
  - add coverage for:
    - default branch
    - single-segment branch
    - slash branch
    - tag
    - commit
    - tree/blob with subpaths
    - branch-vs-tag name collision
- `tests/repo-url.test.ts`
  - assert `repoSourceToPath()` and `parseRepoRoutePath()` round-trip for slash refs
- `tests/chat-routes.test.tsx` and `tests/landing-page.test.tsx`
  - update expected canonical navigation paths if explicit refs move to `/tree/...` and `/commit/...`

## Implementation todo list

### Phase 0 — Baseline and failure matrix

- [x] Reproduce the original `/tree/hugomano/custom_call` failure against a public repo to confirm the current crash path.
- [x] Reproduce at least one failing example for each supported route family we currently know is affected:
  - [x] repo root / default branch
  - [x] explicit branch
  - [x] explicit commit
  - [x] tag
  - [x] tree route with subpath
  - [x] blob route with subpath
  - [x] unsupported-page fallback
- [x] Record which failures happen during **ref resolution** vs **tree loading** so the implementation can be verified in layers.
- [x] Identify the current tests/mocks that incorrectly encode GitHub behavior and need to be rewritten.

### Phase 1 — Fix `just-github` tree loading

- [x] Update the commit response type in `just-github/src/github-client.ts` to match the real GitHub payload shape.
- [x] Change `fetchTree()` to read the tree SHA from the nested commit payload instead of the nonexistent top-level field.
- [x] Confirm branch-backed and commit-backed `GitHubFs.tree()` calls no longer throw the `reading 'sha'` error.
- [x] Verify `readFile()`, `stat()`, and `tree()` still behave correctly after the payload-shape fix.
- [x] Update `just-github/tests/github-fs.test.ts` to use realistic commit payload mocks.
- [x] Update `tests/lib/github-fs.test.ts` to use realistic commit payload mocks.

### Phase 2 — Ref resolution for branches, tags, commits, and slash refs

- [x] Add Git refs lookup helpers in `packages/pi/src/repo/ref-resolver.ts` for:
  - [x] `git/ref/heads/<candidate>`
  - [x] `git/ref/tags/<candidate>`
- [x] Stop using `/commits/heads/...` and `/commits/tags/...` as branch/tag existence probes.
- [x] Keep `/commits/<sha>` only for validating full commit SHAs.
- [x] Preserve longest-prefix matching for slash refs in `resolveTailAsRef()`.
- [x] Ensure tree/blob routes continue scanning candidates when a longer branch/tag candidate does not exist.
- [x] Ensure commit-SHA-prefixed tree/blob routes can fall through to commit resolution instead of dying in branch/tag probes.
- [x] Preserve branch-over-tag precedence when the same name exists in both namespaces.
- [x] Keep unsupported-page fallback resolving to the default branch.
- [x] Preserve a clear explicit error for annotated tags that do not resolve to commits.

### Phase 3 — Canonicalize internal app URLs to GitHub-shaped routes

- [x] Update `packages/pi/src/repo/url.ts` so canonical generated paths are:
  - [x] `/owner/repo` for default refs
  - [x] `/owner/repo/tree/<ref>` for explicit branches/tags
  - [x] `/owner/repo/commit/<sha>` for explicit commits
- [x] Remove assumptions in app navigation/tests that explicit refs can be emitted as `/owner/repo/<ref>`.
- [x] Audit route entry points to ensure generated paths and parsed paths now round-trip cleanly.
- [x] Verify slash refs remain encoded/decoded correctly when navigating through the app UI.

### Phase 4 — Update and expand automated coverage

- [x] Rewrite `tests/ref-resolver.test.ts` around real GitHub response behavior instead of simplified 404-only assumptions.
- [x] Add resolver coverage for:
  - [x] repo root → default branch
  - [x] explicit single-segment branch
  - [x] explicit slash branch
  - [x] explicit tag
  - [x] explicit commit
  - [x] tree route with slash branch + subpath
  - [x] blob route with slash branch + subpath
  - [x] tree/blob route with commit SHA prefix
  - [x] unsupported-page fallback
  - [x] branch-vs-tag name collision
- [x] Update `tests/repo-url.test.ts` to assert canonical GitHub-shaped app paths.
- [x] Update `tests/chat-routes.test.tsx` for the new canonical paths.
- [x] Update `tests/landing-page.test.tsx` for the new canonical paths.
- [x] Add or update any integration-style tests that exercise `repoSourceToPath()` + route parsing together.

### Phase 5 — Runtime and UX verification

- [x] Verify a public repo root can be opened and traversed with `GitHubFs.tree()`.
- [x] Verify a branch with a slash can be opened from a GitHub-style `/tree/<ref>` URL.
- [x] Verify a blob URL resolves the ref correctly and preserves the file subpath.
- [x] Verify a commit URL resolves and supports repo reads/tree traversal where supported.
- [x] Verify a normal tag URL resolves and browses correctly.
- [x] Verify unsupported GitHub pages still fall back to the repo root/default branch instead of crashing.
- [x] Verify the runtime tools no longer surface secondary misleading errors before the primary GitHub/ref error is handled.

### Phase 6 — Final validation and ship criteria

- [x] Run the targeted test files for `just-github`, repo URL parsing, and ref resolution.
- [x] Run the full test suite with Bun.
  - Targeted repo/ref suites pass. The broader suite still contains unrelated pre-existing failures outside this GitHub ref-loading scope.
- [x] Re-check `github-plan.md` against the shipped behavior and remove anything stale if implementation details changed.
- [x] Confirm every item in the route audit table is either fixed or intentionally unsupported with a clear error.

## Definition of done

- Branch, tag, commit, repo-root, tree, blob, and unsupported-page fallback routes all resolve correctly.
- Slash refs work both from GitHub-style incoming URLs and from app-generated internal URLs.
- `bash`, directory traversal, and stat operations no longer crash on resolved refs.
- Tests cover the real GitHub payload/status behavior that caused this bug.
