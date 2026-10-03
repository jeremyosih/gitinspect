# GitInspect performance comparison

Measured on 2026-10-03 against original commit `0f30313ef198d1aecc380489cd2429f51d4a9371` and the application implementation in cleanup commit `c1a426a3fb2bf7c6005664a8166d1bca04c37643`. Raw samples are in [vfs.json](results/vfs.json) and [browser-engine.json](results/browser-engine.json). The benchmark tooling is committed separately from that application revision.

**The VFS has faster repeated reads and directory traversal. FX is not faster than Pi in these controlled warm-browser turns.** This is an architecture and correctness cleanup, with workload-dependent performance changes.

## Conditions

- Apple M1 Pro, macOS ARM64, Bun 1.4.2 for VFS; Chromium 152 / Electron 44.4.2 in the T3 browser for agent turns.
- Eleven measured pairs after three warm-up pairs, alternating original/cleanup order. Implementations run sequentially. Each workload checks returned bytes, directory counts, streamed text, tool execution count, provider request count and restored tool history.
- No real GitHub or model traffic, credentials, billing or model generation. The fixture has 100 directories and 20000 files, each 2300 bytes. Simulated HTTP latency is 20 ms per GitHub request except the CPU-only directory case.
- Browser turns use the original Pi 0.62 agent + Codex SSE parser and the real libfx 0.0.12 browser WASM + the new Codex SDK adapter, in a DedicatedWorker with JSPI. Both receive identical Codex Responses SSE payloads (16 text deltas) and the same instructions and read tool. There is either zero delay or a 50 ms delay before each provider response.
- Browser libraries and WASM are warmed. Cold page load, initial bundle/WASM download, authentication, transcript IndexedDB writes, Effect coordinator scopes and UI rendering are **not** timed. Provider client/proxy setup is outside the timed turn. Browser figures are agent-loop/transport/lifecycle measurements, not full-app or real-model latency.
- Total browser time includes agent creation and the turn; FX also checkpoints and closes, matching the new per-turn lifecycle. The original Pi runner retains its state after completion. For follow-up, Pi uses that retained runner; FX closes after an initial tool turn, then recreates from its checkpoint. The initial tool turn is outside the follow-up timing. Checkpoint creation/close times, initialization times and all samples are retained in the JSON.
- Times below are milliseconds, **median (p95)**. With eleven samples, nearest-rank p95 is the maximum sample. Submillisecond browser figures have limited timer precision; the VFS request counts are more robust than tiny timing differences. Fixed-latency fixtures omit network throughput, real API throttling and streaming token cadence.

## VFS

Warm setup explicitly loads each implementation's recursive tree before timing. For the text/binary case it also warms text content. Setup requests are excluded from the warm rows; all requests are included in cold rows. This prevents crediting the new VFS for warming that the original did not receive.

| Workload                                        |     Original ms |      Cleanup ms | Requests during timing |
| ----------------------------------------------- | --------------: | --------------: | ---------------------: |
| cold single-file read                           |   65.54 (68.50) | 111.28 (134.68) |                  3 → 4 |
| 20 repeated text reads, no directory prefetch   | 488.40 (492.74) | 121.19 (137.99) |                 22 → 4 |
| 20 warm text/binary/text cycles                 | 888.83 (912.99) |     0.44 (0.61) |                 40 → 0 |
| 32 concurrent reads of the same uncached file   |   23.88 (24.83) |   22.41 (23.74) |                 32 → 1 |
| 24 concurrent reads of different uncached files |   23.67 (25.34) |   90.02 (92.09) |                24 → 24 |
| 500 warm directory listings, 20,000 files       | 130.64 (145.56) |     7.02 (7.88) |                  0 → 0 |

Repeated text reads improve about 4×. Warm directory listings improve about 19×. Mixed text/binary reads avoid 40 HTTP calls because the new cache shares canonical bytes between both read modes. Concurrent same-file reads reduce 32 calls to one; their wall time changes little because the original calls were parallel.

Cold single-file access is about 1.7× slower: the new VFS fetches/indexes the complete tree and then the blob, while the original calls Contents directly. A 24-file parallel burst is about 3.8× slower: the new six-request limit takes four batches, while the original starts all requests together. This limit controls API pressure; these numbers should not be described as a universal VFS speedup. The incomplete-tree fallback and cancellation correctness improvements are verified by tests, rather than counted as faster results.

## Browser agent

Text = one provider response. Tool = one read call plus a second response. Follow-up = one response after restoring/retaining the previous tool transcript. The tool returns a fixed string, so VFS performance is isolated from agent overhead.

| Turn     | Delay per response ms |     Pi total ms |     FX total ms | Pi first-text ms | FX first-text ms |
| -------- | --------------------: | --------------: | --------------: | ---------------: | ---------------: |
| text     |                     0 |     0.30 (0.60) |     4.10 (9.90) |      0.30 (0.50) |      2.30 (8.60) |
| text     |                    50 |   55.70 (59.20) |   59.50 (65.30) |    55.50 (57.40) |    57.10 (61.60) |
| tool     |                     0 |     0.50 (1.20) |    4.80 (10.70) |      0.50 (0.70) |      3.40 (9.30) |
| tool     |                    50 | 110.50 (116.50) | 116.30 (126.30) |  110.20 (115.60) |  114.90 (123.40) |
| followup |                     0 |     0.20 (0.90) |     3.10 (9.20) |      0.20 (0.30) |      1.80 (8.10) |
| followup |                    50 |   55.40 (57.20) |   58.80 (60.80) |    55.30 (56.90) |    57.00 (58.80) |

FX adds roughly 3–6 ms to warm completion here, including its checkpoint/close lifecycle. With 50 ms simulated provider delay, the completion regression is about 5–7%. First-text differences are smaller. This does not establish any improvement in model inference speed, and these short transcripts do not characterize long-history checkpoint costs.

## Reproduce

1. Use Bun and a JSPI-capable Chromium browser. From the checkout root run `bun run bench:prepare`; this creates an ignored detached worktree at the exact original commit, installs its frozen lockfile and bundles the original browser engine. Preparation verifies the baseline revision. It prints the browser console command with your checkout path.
2. Run `bun run bench:vfs` with other CPU-heavy work idle. Results replace `benchmarks/results/vfs.json`.
3. Start the normal web dev server with its documented environment. Wait for Vite dependency optimization to settle. Open a same-origin JSON API page (for example `/api/shares/benchmark?view=public`) so app HMR cannot interrupt the benchmark; sharing does not need to be configured. Use the console command printed by preparation. It runs in a temporary DedicatedWorker and leaves credentials/chats unchanged. The only non-fixture fetches are local benchmark metadata and the WASM asset.
4. Save `window.__gitinspectBenchmarkResult` as `benchmarks/results/browser-engine.json` (DevTools: `copy(JSON.stringify(window.__gitinspectBenchmarkResult, null, 2))`). Run sequentially after the VFS benchmark, not concurrently. Then `bun run bench:report` regenerates this report from the saved results.

No Cloudflare resources are created by these benchmarks. Re-run when tuning the VFS concurrency or changing the FX lifecycle; do not extrapolate the fixture numbers into production latency promises.
