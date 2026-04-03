import { describe, expect, it } from "vitest";
import { parseRepoInput, parseRepoRoutePath } from "@/repo/path-parser";
import {
  githubOwnerAvatarUrl,
  githubRepoPathUrl,
  githubRepoUrl,
  repoSourceToGitHubUrl,
  repoSourceToPath,
} from "@/repo/url";

describe("parseRepoRoutePath", () => {
  it("parses repo root", () => {
    expect(parseRepoRoutePath("/vercel/next.js")).toEqual({
      owner: "vercel",
      repo: "next.js",
      type: "repo-root",
    });
  });

  it("parses shorthand refs", () => {
    expect(parseRepoRoutePath("/vercel/next.js/canary")).toEqual({
      owner: "vercel",
      rawRef: "canary",
      repo: "next.js",
      type: "shorthand-ref",
    });
  });

  it("parses tree pages with full tails", () => {
    expect(parseRepoRoutePath("/vercel/next.js/tree/feature/foo/src/lib")).toEqual({
      owner: "vercel",
      repo: "next.js",
      tail: "feature/foo/src/lib",
      type: "tree-page",
    });
  });

  it("parses blob pages with full tails", () => {
    expect(parseRepoRoutePath("/vercel/next.js/blob/main/README.md")).toEqual({
      owner: "vercel",
      repo: "next.js",
      tail: "main/README.md",
      type: "blob-page",
    });
  });

  it("parses commit pages", () => {
    expect(
      parseRepoRoutePath("/vercel/next.js/commit/0123456789abcdef0123456789abcdef01234567"),
    ).toEqual({
      owner: "vercel",
      repo: "next.js",
      sha: "0123456789abcdef0123456789abcdef01234567",
      type: "commit-page",
    });
  });

  it("classifies unsupported repo pages explicitly", () => {
    expect(parseRepoRoutePath("/vercel/next.js/issues/1")).toEqual({
      owner: "vercel",
      page: "issues",
      repo: "next.js",
      type: "unsupported-repo-page",
    });
  });

  it("returns invalid for missing owner or repo", () => {
    expect(parseRepoRoutePath("/vercel")).toEqual({
      reason: "Missing owner/repo",
      type: "invalid",
    });
  });

  it("returns invalid for reserved root paths", () => {
    expect(parseRepoRoutePath("/chat")).toEqual({
      reason: "Missing owner/repo",
      type: "invalid",
    });
  });

  it("decodes encoded tails", () => {
    expect(parseRepoRoutePath("/vercel/next.js/tree/feature%2Ffoo/src%20lib")).toEqual({
      owner: "vercel",
      repo: "next.js",
      tail: "feature/foo/src lib",
      type: "tree-page",
    });
  });
});

describe("parseRepoInput", () => {
  it("supports owner/repo shorthand", () => {
    expect(parseRepoInput("vercel/next.js")).toEqual({
      owner: "vercel",
      repo: "next.js",
      type: "repo-root",
    });
  });

  it("supports github.com URLs without a scheme", () => {
    expect(parseRepoInput("github.com/vercel/next.js/tree/main/packages")).toEqual({
      owner: "vercel",
      repo: "next.js",
      tail: "main/packages",
      type: "tree-page",
    });
  });

  it("supports full GitHub URLs", () => {
    expect(parseRepoInput("https://github.com/vercel/next.js/blob/main/README.md")).toEqual({
      owner: "vercel",
      repo: "next.js",
      tail: "main/README.md",
      type: "blob-page",
    });
  });

  it("supports .git clone URLs", () => {
    expect(parseRepoInput("https://github.com/vercel/next.js.git")).toEqual({
      owner: "vercel",
      repo: "next.js",
      type: "repo-root",
    });
  });

  it("rejects non-GitHub hosts", () => {
    expect(parseRepoInput("https://gitlab.com/foo/bar")).toEqual({
      reason: "Unsupported host: gitlab.com",
      type: "invalid",
    });
  });
});

describe("githubOwnerAvatarUrl", () => {
  it("builds github avatar URL for owner", () => {
    expect(githubOwnerAvatarUrl("vercel")).toBe("https://github.com/vercel.png");
  });

  it("encodes special characters in owner", () => {
    expect(githubOwnerAvatarUrl("foo/bar")).toBe("https://github.com/foo%2Fbar.png");
  });
});

describe("githubRepoUrl", () => {
  it("builds repo root URLs", () => {
    expect(githubRepoUrl("acme", "demo")).toBe("https://github.com/acme/demo");
  });

  it("encodes path segments for repo page URLs", () => {
    expect(githubRepoPathUrl("acme", "demo", "blob/feature/foo/README.md")).toBe(
      "https://github.com/acme/demo/blob/feature/foo/README.md",
    );
    expect(githubRepoPathUrl("acme org", "demo repo", "tree/feature branch/src lib")).toBe(
      "https://github.com/acme%20org/demo%20repo/tree/feature%20branch/src%20lib",
    );
  });
});

describe("repoSourceToGitHubUrl", () => {
  it("falls back to the repo root for default refs", () => {
    expect(
      repoSourceToGitHubUrl({
        owner: "acme",
        ref: "main",
        refOrigin: "default",
        repo: "demo",
        resolvedRef: {
          apiRef: "heads/main",
          fullRef: "refs/heads/main",
          kind: "branch",
          name: "main",
        },
      }),
    ).toBe("https://github.com/acme/demo");
  });

  it("uses tree URLs for explicit branch refs", () => {
    expect(
      repoSourceToGitHubUrl({
        owner: "acme",
        ref: "feature/foo",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          apiRef: "heads/feature/foo",
          fullRef: "refs/heads/feature/foo",
          kind: "branch",
          name: "feature/foo",
        },
      }),
    ).toBe("https://github.com/acme/demo/tree/feature/foo");
  });

  it("uses commit URLs for commit refs", () => {
    expect(
      repoSourceToGitHubUrl({
        owner: "acme",
        ref: "0123456789abcdef0123456789abcdef01234567",
        refOrigin: "explicit",
        repo: "demo",
        resolvedRef: {
          kind: "commit",
          sha: "0123456789abcdef0123456789abcdef01234567",
        },
      }),
    ).toBe("https://github.com/acme/demo/commit/0123456789abcdef0123456789abcdef01234567");
  });
});

describe("repoSourceToPath", () => {
  it("omits the default branch from canonical paths", () => {
    expect(
      repoSourceToPath({
        owner: "acme",
        ref: "main",
        refOrigin: "default",
        repo: "demo",
      }),
    ).toBe("/acme/demo");
  });

  it("canonicalizes explicit branch refs to tree routes", () => {
    expect(
      repoSourceToPath({
        owner: "acme",
        ref: "feature/foo",
        refOrigin: "explicit",
        repo: "demo",
      }),
    ).toBe("/acme/demo/tree/feature/foo");
  });

  it("canonicalizes explicit tag refs to tree routes", () => {
    expect(
      repoSourceToPath({
        owner: "acme",
        ref: "v1.2.3",
        refOrigin: "explicit",
        repo: "demo",
      }),
    ).toBe("/acme/demo/tree/v1.2.3");
  });

  it("canonicalizes explicit commit refs to commit routes", () => {
    expect(
      repoSourceToPath({
        owner: "acme",
        ref: "0123456789abcdef0123456789abcdef01234567",
        refOrigin: "explicit",
        repo: "demo",
      }),
    ).toBe("/acme/demo/commit/0123456789abcdef0123456789abcdef01234567");
  });

  it("round-trips generated canonical paths back through the parser", () => {
    const branchPath = repoSourceToPath({
      owner: "acme",
      ref: "feature/foo",
      refOrigin: "explicit",
      repo: "demo",
    });
    const commitPath = repoSourceToPath({
      owner: "acme",
      ref: "0123456789abcdef0123456789abcdef01234567",
      refOrigin: "explicit",
      repo: "demo",
    });

    expect(parseRepoRoutePath(branchPath)).toEqual({
      owner: "acme",
      repo: "demo",
      tail: "feature/foo",
      type: "tree-page",
    });
    expect(parseRepoRoutePath(commitPath)).toEqual({
      owner: "acme",
      repo: "demo",
      sha: "0123456789abcdef0123456789abcdef01234567",
      type: "commit-page",
    });
  });
});
