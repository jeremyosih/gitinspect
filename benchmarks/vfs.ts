import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { GitHubFs as NewFs } from "../packages/vfs/src/github-fs";
import { baseline, BASELINE_COMMIT, prepare, output } from "./prepare";
import { summarize } from "./stats";

await prepare();
const { GitHubFs: OldFs } = await import(
  resolve(baseline, "packages/just-github/src/github-fs.ts")
);
const iterations = 11;
const warmups = 3;
const directories = 100;
const filesPerDirectory = 200;
const content = "# GitInspect benchmark\n".repeat(100);
const bytes = new TextEncoder().encode(content);
const encoded = btoa(content);
const entries: Record<string, unknown>[] = [];
for (let dir = 0; dir < directories; dir++) {
  entries.push({ path: `dir-${dir}`, type: "tree", mode: "040000", sha: `tree-${dir}` });
  for (let file = 0; file < filesPerDirectory; file++)
    entries.push({
      path: `dir-${dir}/file-${file}.txt`,
      type: "blob",
      mode: "100644",
      size: bytes.length,
      sha: `blob-${dir}-${file}`,
    });
}
let requestCount = 0;
let latency = 0;
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.hostname !== "fixture.invalid") throw new Error(`Unexpected network request: ${url}`);
  requestCount++;
  if (latency) await Bun.sleep(latency);
  if (url.pathname.includes("/git/ref/"))
    return Response.json({ object: { type: "commit", sha: "fixture-commit" } });
  if (url.pathname.includes("/commits/"))
    return Response.json({ sha: "fixture-commit", commit: { tree: { sha: "fixture-tree" } } });
  if (url.pathname.includes("/git/trees/"))
    return Response.json({ sha: "fixture-tree", truncated: false, tree: entries });
  if (url.pathname.includes("/git/blobs/"))
    return Response.json({ size: bytes.length, encoding: "base64", content: encoded });
  if (url.pathname.includes("/contents/"))
    return Response.json({
      type: "file",
      sha:
        "blob-" +
        (url.pathname
          .match(/dir-(\d+)\/file-(\d+)\.txt/)
          ?.slice(1)
          .join("-") ?? "0-0"),
      size: bytes.length,
      encoding: "base64",
      content: encoded,
    });
  throw new Error(`Unknown fixture request: ${url}`);
};
const options = {
  owner: "fixture",
  repo: "repo",
  baseUrl: "https://fixture.invalid",
  ref: { kind: "branch", name: "main", apiRef: "heads/main", fullRef: "refs/heads/main" },
} as const;
type Fs = InstanceType<typeof NewFs>;
const checkText = (value: string) => {
  if (value !== content) throw new Error("Text differs");
};
const checkBytes = (value: Uint8Array) => {
  if (value.length !== bytes.length || value.some((byte, i) => byte !== bytes[i]))
    throw new Error("Bytes differ");
};
const cases: Array<{
  name: string;
  latency: number;
  setup?: (fs: Fs) => Promise<void>;
  run: (fs: Fs) => Promise<void>;
}> = [
  {
    name: "cold single-file read",
    latency: 20,
    run: async (fs) => checkText(await fs.readFile("dir-0/file-0.txt")),
  },
  {
    name: "20 repeated text reads, no directory prefetch",
    latency: 20,
    run: async (fs) => {
      for (let i = 0; i < 20; i++) checkText(await fs.readFile("dir-0/file-0.txt"));
    },
  },
  {
    name: "20 warm text/binary/text cycles",
    latency: 20,
    setup: async (fs) => {
      await fs.tree();
      checkText(await fs.readFile("dir-0/file-0.txt"));
    },
    run: async (fs) => {
      for (let i = 0; i < 20; i++) {
        checkBytes(await fs.readFileBuffer("dir-0/file-0.txt"));
        checkText(await fs.readFile("dir-0/file-0.txt"));
      }
    },
  },
  {
    name: "32 concurrent reads of the same uncached file",
    latency: 20,
    setup: async (fs) => {
      await fs.tree();
    },
    run: async (fs) => {
      (
        await Promise.all(Array.from({ length: 32 }, () => fs.readFile("dir-0/file-0.txt")))
      ).forEach(checkText);
    },
  },
  {
    name: "24 concurrent reads of different uncached files",
    latency: 20,
    setup: async (fs) => {
      await fs.tree();
    },
    run: async (fs) => {
      (
        await Promise.all(Array.from({ length: 24 }, (_, i) => fs.readFile(`dir-0/file-${i}.txt`)))
      ).forEach(checkText);
    },
  },
  {
    name: "500 warm directory listings, 20,000 files",
    latency: 0,
    setup: async (fs) => {
      await fs.tree();
    },
    run: async (fs) => {
      for (let i = 0; i < 500; i++)
        if ((await fs.readdir(`dir-${i % directories}`)).length !== filesPerDirectory)
          throw new Error("Directory entries differ");
    },
  },
];
const results = [];
try {
  for (const scenario of cases) {
    const samples: Record<string, Array<{ ms: number; requests: number }>> = {
      original: [],
      cleanup: [],
    };
    for (let iteration = -warmups; iteration < iterations; iteration++) {
      // Alternate order so neither implementation systematically benefits from warming.
      const versions = iteration % 2 ? ["cleanup", "original"] : ["original", "cleanup"];
      for (const version of versions) {
        latency = scenario.latency;
        const fs = new (version === "original" ? OldFs : NewFs)(options) as Fs;
        await scenario.setup?.(fs);
        const requestsBefore = requestCount;
        const started = performance.now();
        await scenario.run(fs);
        const sample = { ms: performance.now() - started, requests: requestCount - requestsBefore };
        if (iteration >= 0) samples[version]!.push(sample);
      }
    }
    const row = {
      name: scenario.name,
      latencyMs: scenario.latency,
      original: {
        timeMs: summarize(samples.original!.map((s) => s.ms)),
        requests: summarize(samples.original!.map((s) => s.requests)),
        samples: samples.original,
      },
      cleanup: {
        timeMs: summarize(samples.cleanup!.map((s) => s.ms)),
        requests: summarize(samples.cleanup!.map((s) => s.requests)),
        samples: samples.cleanup,
      },
    };
    results.push(row);
    console.log(
      `${scenario.name}: original ${row.original.timeMs.median.toFixed(2)} ms / ${row.original.requests.median} requests; cleanup ${row.cleanup.timeMs.median.toFixed(2)} ms / ${row.cleanup.requests.median} requests`,
    );
  }
} finally {
  globalThis.fetch = nativeFetch;
}
mkdirSync(resolve(import.meta.dir, "results"), { recursive: true });
writeFileSync(
  resolve(import.meta.dir, "results/vfs.json"),
  JSON.stringify(
    {
      ...JSON.parse(readFileSync(resolve(output, "revision.json"), "utf8")),
      baseline: BASELINE_COMMIT,
      date: new Date().toISOString(),
      bun: Bun.version,
      architecture: process.arch,
      platform: process.platform,
      iterations,
      warmups,
      fixture: { directories, filesPerDirectory, fileBytes: bytes.length },
      results,
    },
    null,
    2,
  ) + "\n",
);
