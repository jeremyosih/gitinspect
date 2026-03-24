import { vi } from "vitest"

const mockFileContent = {
  "README.md": {
    content: btoa("# GitOverflow\nA local agent.\n"),
    download_url:
      "https://raw.githubusercontent.com/test-owner/test-repo/main/README.md",
    encoding: "base64",
    name: "README.md",
    path: "README.md",
    sha: "readme-sha",
    size: 29,
    type: "file",
  },
  "src/index.ts": {
    content: btoa("export const hello = 'world'\nexport const tool = 'read'\n"),
    download_url:
      "https://raw.githubusercontent.com/test-owner/test-repo/main/src/index.ts",
    encoding: "base64",
    name: "index.ts",
    path: "src/index.ts",
    sha: "index-sha",
    size: 54,
    type: "file",
  },
  "src/long.txt": {
    content: btoa(Array.from({ length: 6 }, (_, index) => `line-${index + 1}`).join("\n")),
    download_url:
      "https://raw.githubusercontent.com/test-owner/test-repo/main/src/long.txt",
    encoding: "base64",
    name: "long.txt",
    path: "src/long.txt",
    sha: "long-sha",
    size: 41,
    type: "file",
  },
}

const mockTreeResponse = {
  sha: "tree-sha",
  tree: [
    { mode: "100644", path: "README.md", sha: "readme-sha", size: 29, type: "blob" },
    { mode: "040000", path: "src", sha: "src-sha", type: "tree" },
    { mode: "100644", path: "src/index.ts", sha: "index-sha", size: 54, type: "blob" },
    { mode: "100644", path: "src/long.txt", sha: "long-sha", size: 41, type: "blob" },
  ],
  truncated: false,
}

const mockDirectoryContent = [
  { download_url: null, name: "index.ts", path: "src/index.ts", sha: "index-sha", size: 54, type: "file" },
  { download_url: null, name: "long.txt", path: "src/long.txt", sha: "long-sha", size: 41, type: "file" },
]

const mockRefResponse = {
  object: { sha: "commit-sha", type: "commit" },
}

const mockCommitResponse = {
  tree: { sha: "tree-sha" },
}

export function installMockRepoFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)

    if (url.includes("git/ref/heads/main")) {
      return createJsonResponse(mockRefResponse)
    }

    if (url.includes("git/commits/commit-sha")) {
      return createJsonResponse(mockCommitResponse)
    }

    if (url.includes("git/trees/tree-sha?recursive=1")) {
      return createJsonResponse(mockTreeResponse)
    }

    if (url.includes("contents/src?ref=")) {
      return createJsonResponse(mockDirectoryContent)
    }

    for (const [path, response] of Object.entries(mockFileContent)) {
      if (url.includes(`contents/${path}`)) {
        return createJsonResponse(response)
      }
    }

    return new Response("Not Found", { status: 404 })
  })

  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function createJsonResponse(value: object): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "Content-Type": "application/json",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4999",
      "x-ratelimit-reset": "1700000000",
    },
    status: 200,
  })
}
