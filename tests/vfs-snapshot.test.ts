import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { GitHubFs } from "../packages/vfs/src/github-fs";
import { ContentCache } from "../packages/vfs/src/cache";
const file = { path: "README.md", sha: "blob", type: "blob", mode: "100644", size: 5 };
const ref = {
  kind: "branch" as const,
  name: "main",
  apiRef: "heads/main" as const,
  fullRef: "refs/heads/main" as const,
};
const options = { owner: "owner", repo: "repo", ref };
function transport(
  overrides: (url: string, init?: RequestInit) => Response | Promise<Response> | undefined = () =>
    undefined,
) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const response = await overrides(url, init);
    if (response) return response;
    if (url.includes("git/ref/heads/main"))
      return Response.json({ object: { type: "commit", sha: "commit" } });
    if (url.includes("commits/commit"))
      return Response.json({ sha: "commit", commit: { tree: { sha: "root" } } });
    if (url.includes("git/trees/root"))
      return Response.json({ sha: "root", truncated: false, tree: [file] });
    if (url.includes("git/blobs/blob"))
      return Response.json({ sha: "blob", size: 5, encoding: "base64", content: btoa("hello") });
    return Response.json({ message: "Not Found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());
describe("immutable VFS", () => {
  it("shares simultaneous tree and blob requests and caches one canonical byte representation", async () => {
    const fetch = transport();
    const fs = new GitHubFs(options);
    const [text, bytes, stat] = await Promise.all([
      fs.readFile("README.md"),
      fs.readFileBuffer("README.md"),
      fs.stat("README.md"),
    ]);
    expect(text).toBe("hello");
    expect(new TextDecoder().decode(bytes)).toBe("hello");
    expect(stat.isFile).toBe(true);
    await fs.readFile("README.md");
    await fs.readFileBuffer("README.md");
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("git/trees/"))).toHaveLength(1);
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("git/blobs/"))).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(4);
    bytes[0] = 0;
    expect(await fs.readFile("README.md")).toBe("hello");
  });
  it("loads missing directories from non-recursive trees after GitHub truncation", async () => {
    const fetch = transport((url) => {
      if (url.endsWith("git/trees/root?recursive=1"))
        return Response.json({ sha: "root", truncated: true, tree: [file] });
      if (url.endsWith("git/trees/root"))
        return Response.json({
          sha: "root",
          truncated: false,
          tree: [{ path: "src", sha: "src", type: "tree", mode: "040000" }],
        });
      if (url.endsWith("git/trees/src"))
        return Response.json({
          sha: "src",
          truncated: false,
          tree: [{ ...file, path: "missing.ts" }],
        });
    });
    const fs = new GitHubFs(options);
    expect(await fs.readFile("src/missing.ts")).toBe("hello");
    expect(await fs.readdir("src")).toEqual(["missing.ts"]);
    expect(await fs.exists("src/no.ts")).toBe(false);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("git/trees/src"))).toHaveLength(
      1,
    );
  });
  it("preserves spaces and distinguishes symlinks from their targets", async () => {
    transport((url) => {
      if (url.includes("git/trees/"))
        return Response.json({
          sha: "root",
          truncated: false,
          tree: [
            { ...file, path: " spaced file " },
            { ...file, path: "link", sha: "link", mode: "120000" },
          ],
        });
      if (url.includes("git/blobs/link"))
        return Response.json({
          sha: "link",
          size: 13,
          encoding: "base64",
          content: btoa(" spaced file "),
        });
    });
    const fs = new GitHubFs(options);
    expect(await fs.readFile(" spaced file ")).toBe("hello");
    expect(await fs.readlink("link")).toBe(" spaced file ");
    expect((await fs.lstat("link")).isSymbolicLink).toBe(true);
    expect((await fs.stat("link")).isFile).toBe(true);
    expect(await fs.realpath("link")).toBe("/ spaced file ");
    await expect(fs.realpath("missing")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readlink(" spaced file ")).rejects.toMatchObject({ code: "EINVAL" });
  });
  it("fails symlink cycles without infinite fetches", async () => {
    transport((url) =>
      url.includes("git/trees/")
        ? Response.json({
            sha: "root",
            truncated: false,
            tree: [{ ...file, path: "link", sha: "link", mode: "120000" }],
          })
        : url.includes("git/blobs/link")
          ? Response.json({ sha: "link", size: 4, encoding: "base64", content: btoa("link") })
          : undefined,
    );
    await expect(new GitHubFs(options).readFile("link")).rejects.toMatchObject({ code: "ELOOP" });
  });
  it("keeps a shared read alive when only one caller cancels", async () => {
    let resolve!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    transport((url, init) => {
      if (url.includes("git/blobs/")) {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((r) => (resolve = r));
      }
    });
    const fs = new GitHubFs(options);
    await fs.stat("README.md");
    const first = new AbortController();
    const a = fs.readFileBuffer("README.md", first.signal);
    const b = fs.readFileBuffer("README.md");
    await vi.waitFor(() => expect(resolve).toBeDefined());
    first.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(signal?.aborted).toBe(false);
    resolve(Response.json({ sha: "blob", size: 5, encoding: "base64", content: btoa("hello") }));
    expect(new TextDecoder().decode(await b)).toBe("hello");
  });
  it("aborts HTTP when the last caller cancels and permits a subsequent retry", async () => {
    let signal: AbortSignal | undefined;
    let block = true;
    transport((url, init) => {
      if (url.includes("git/blobs/") && block) {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((_, reject) =>
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }),
        );
      }
    });
    const fs = new GitHubFs(options);
    await fs.stat("README.md");
    const controller = new AbortController();
    const read = fs.readFileBuffer("README.md", controller.signal);
    await vi.waitFor(() => expect(signal).toBeDefined());
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    block = false;
    await expect(fs.readFile("README.md")).resolves.toBe("hello");
  });
  it("pins refresh to the original commit while opening a new snapshot observes branch changes", async () => {
    const fetch = transport();
    const fs = new GitHubFs(options);
    await fs.readFile("README.md");
    fs.refresh();
    await fs.readFile("README.md");
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("git/ref/"))).toHaveLength(1);
    expect(await fs.snapshotCommit()).toBe("commit");
  });
  it("retries immediately after cancelling commit resolution", async () => {
    let requestSignal: AbortSignal | undefined;
    let block = true;
    transport((url, init) => {
      if (block && url.includes("git/ref/")) {
        requestSignal = init?.signal ?? undefined;
        return new Promise<Response>((_, reject) =>
          requestSignal!.addEventListener("abort", () => reject(requestSignal!.reason), {
            once: true,
          }),
        );
      }
    });
    const fs = new GitHubFs(options);
    const controller = new AbortController();
    const read = fs.readFileBuffer("README.md", controller.signal);
    await vi.waitFor(() => expect(requestSignal).toBeDefined());
    controller.abort();
    await expect(read).rejects.toMatchObject({ name: "AbortError" });
    block = false;
    await expect(fs.readFile("README.md")).resolves.toBe("hello");
  });
  it("does not carry an earlier caller's abort into refreshed reads", async () => {
    const fetch = transport();
    const fs = new GitHubFs(options);
    const controller = new AbortController();
    await fs.readFileBuffer("README.md", controller.signal);
    controller.abort();
    fs.refresh();
    await expect(fs.readFile("README.md")).resolves.toBe("hello");
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("git/ref/"))).toHaveLength(1);
  });
  it("never retains an oversized cache entry or evicts useful entries to try", () => {
    const cache = new ContentCache({ maxBytes: 3, maxEntries: 2 });
    cache.set("small", new Uint8Array([1]));
    cache.set("big", new Uint8Array([1, 2, 3, 4]));
    expect(cache.get("big")).toBeUndefined();
    expect(cache.has("small")).toBe(true);
  });
  it("enforces file size before downloading and rejects submodule traversal and all writes", async () => {
    const fetch = transport((url) =>
      url.includes("git/trees/")
        ? Response.json({
            sha: "root",
            truncated: false,
            tree: [
              { ...file, size: 100 },
              { path: "sub", sha: "sub", mode: "160000", type: "commit" },
            ],
          })
        : undefined,
    );
    const fs = new GitHubFs({ ...options, maxFileBytes: 10 });
    await expect(fs.readFile("README.md")).rejects.toMatchObject({ code: "EFBIG" });
    expect(fetch.mock.calls.some(([url]) => String(url).includes("git/blobs/"))).toBe(false);
    await expect(fs.readFile("sub/file")).rejects.toMatchObject({ code: "ENOTSUP" });
    await expect(fs.writeFile()).rejects.toMatchObject({ code: "EROFS" });
    await expect(fs.utimes()).rejects.toMatchObject({ code: "EROFS" });
  });
});
