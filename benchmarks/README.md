# GitInspect performance comparison

Measured on 2026-10-06 against original commit `0f30313ef198d1aecc380489cd2429f51d4a9371` and the application implementation in cleanup commit `d5c1d32836109e38b972b8670983055f41742619`. Raw samples are in [vfs.json](results/vfs.json), [browser-engine.json](results/browser-engine.json) and [browser-engine-fx.json](results/browser-engine-fx.json). The benchmark tooling is committed separately from that application revision.

**The VFS has faster repeated reads and directory traversal. The Effect-based Pi Durable agent is not faster than the original Pi agent in these controlled warm-browser turns; it costs about the same as the fx engine it replaces.** This is an architecture and correctness cleanup, with workload-dependent performance changes.

## Conditions

- Apple M1 Pro, macOS ARM64, Bun 1.4.2 for VFS; headless Chromium 147 (Playwright's `chrome-headless-shell`) for agent turns.
- Eleven measured pairs after three warm-up pairs, alternating original/cleanup order. Implementations run sequentially. Each workload checks returned bytes, directory counts, streamed text, tool execution count, provider request count and restored tool history.
- No real GitHub or model traffic, credentials, billing or model generation. The fixture has 100 directories and 20000 files, each 2300 bytes. Simulated HTTP latency is 20 ms per GitHub request except the CPU-only directory case.
- Browser turns use the original Pi 0.62 agent + Codex SSE parser, and Pi Durable 1.0.1 through effect-pi-durable + Pi AI's Codex adapter, in a DedicatedWorker. Both receive identical Codex Responses SSE payloads (16 text deltas) and the same instructions and read tool. There is either zero delay or a 50 ms delay before each provider response.
- The fx columns are the previous engine (libfx 0.0.12), re-measured on the same day in the same browser from its own commit `c1a426a3fb2bf7c6005664a8166d1bca04c37643` with that commit's benchmark. Each run has its own original-Pi control; the two controls agree within the timer noise below. fx always closed after a turn and restored a checkpoint, so it has restore rows and no retained follow-up.
- Browser libraries are warmed. Cold page load, initial bundle download, authentication, transcript IndexedDB writes, the app's proxy lookup and UI rendering are **not** timed. Browser figures are agent-loop/transport/lifecycle measurements, not full-app or real-model latency.
- Total browser time includes agent creation and the turn. Follow-up reuses the engine that ran an untimed tool turn, as both apps do within one worker. Restore builds a new engine holding that tool turn first, as after a worker restart: the original from its messages, Pi Durable from the persisted transcript rows. Initialization times and all samples are retained in the JSON.
- First text is when the host can show text. The original and fx report each streamed delta. Pi Durable publishes text with its commits, so here, where a response arrives in one burst, first text is the commit of the finished answer.
- Times below are milliseconds, **median (p95)**. With eleven samples, nearest-rank p95 is the maximum sample. Submillisecond browser figures have limited timer precision, and the 50 ms timer itself fires 2–12 ms late in this headless browser; the VFS request counts are more robust than tiny timing differences. Fixed-latency fixtures omit network throughput, real API throttling and streaming token cadence.

## VFS

Warm setup explicitly loads each implementation's recursive tree before timing. For the text/binary case it also warms text content. Setup requests are excluded from the warm rows; all requests are included in cold rows. This prevents crediting the new VFS for warming that the original did not receive.

| Workload                                        |     Original ms |      Cleanup ms | Requests during timing |
| ----------------------------------------------- | --------------: | --------------: | ---------------------: |
| cold single-file read                           |   66.74 (75.02) | 145.50 (154.32) |                  3 → 4 |
| 20 repeated text reads, no directory prefetch   | 487.49 (519.53) | 142.22 (163.31) |                 22 → 4 |
| 20 warm text/binary/text cycles                 | 889.85 (906.73) |     0.59 (0.63) |                 40 → 0 |
| 32 concurrent reads of the same uncached file   |   24.18 (27.15) |   23.00 (25.31) |                 32 → 1 |
| 24 concurrent reads of different uncached files |   23.98 (25.72) |   92.42 (95.63) |                24 → 24 |
| 500 warm directory listings, 20,000 files       | 126.58 (129.72) |     6.69 (8.98) |                  0 → 0 |

The VFS is unchanged since `c1a426a`; this is a new run of the same code. Repeated text reads improve about 3.5×. Warm directory listings improve about 19×. Mixed text/binary reads avoid 40 HTTP calls because the new cache shares canonical bytes between both read modes. Concurrent same-file reads reduce 32 calls to one; their wall time changes little because the original calls were parallel.

Cold single-file access is about 2.2× slower (1.7× in the earlier run of the same code; this run had other applications active, which the CPU-bound tree indexing is sensitive to): the new VFS fetches/indexes the complete tree and then the blob, while the original calls Contents directly. A 24-file parallel burst is about 3.9× slower: the new six-request limit takes four batches, while the original starts all requests together. This limit controls API pressure; these numbers should not be described as a universal VFS speedup. The incomplete-tree fallback and cancellation correctness improvements are verified by tests, rather than counted as faster results.

## Browser agent

Text = one provider response. Tool = one read call plus a second response. Follow-up = one response on the engine that holds the previous tool turn. Restore = the same response on a new engine built from that turn. The tool returns a fixed string, so VFS performance is isolated from agent overhead.

| Turn     | Delay per response ms | Original total ms | Pi Durable total ms |     fx total ms | Original first-text ms | Pi Durable first-text ms | fx first-text ms |
| -------- | --------------------: | ----------------: | ------------------: | --------------: | ---------------------: | -----------------------: | ---------------: |
| text     |                     0 |       0.20 (0.30) |         1.50 (3.90) |     2.60 (3.20) |            0.10 (0.20) |              1.50 (3.90) |      1.40 (1.70) |
| text     |                    50 |     59.80 (62.00) |       67.60 (74.00) |   68.90 (75.10) |          59.10 (61.50) |            67.60 (74.00) |    64.80 (69.10) |
| tool     |                     0 |       0.50 (0.80) |         2.70 (3.40) |     3.10 (3.40) |            0.50 (0.70) |              2.70 (3.40) |      2.00 (2.30) |
| tool     |                    50 |   119.00 (129.20) |     133.30 (139.50) | 133.20 (140.60) |        118.50 (126.50) |          133.30 (139.50) |  128.80 (136.50) |
| followup |                     0 |       0.20 (0.30) |         0.90 (2.00) |               — |            0.10 (0.20) |              0.90 (1.90) |                — |
| followup |                    50 |     59.20 (61.90) |       62.20 (63.80) |               — |          58.90 (61.50) |            62.10 (63.80) |                — |
| restore  |                     0 |       0.20 (1.00) |         1.10 (2.70) |     2.10 (3.60) |            0.10 (0.90) |              1.10 (2.70) |      1.10 (2.00) |
| restore  |                    50 |     61.00 (62.70) |       65.30 (68.70) |   69.00 (70.30) |          60.40 (62.20) |            65.30 (68.70) |    65.10 (66.50) |

Pi Durable through Effect adds about 1–2 ms to a warm turn with no provider delay, and under 1 ms to a follow-up on a retained conversation. With 50 ms simulated provider delay it adds about 3 ms to a retained follow-up, 4 ms to a restored one, 8 ms to a first text turn and 14 ms to a tool turn (two responses), which is 5–13% of these short turns. Its completion times match fx within about 1–4 ms; fx shows first text about 3–5 ms sooner because it reports deltas. This does not establish any improvement in model inference speed, and these short transcripts do not characterize long conversations or compaction.

## Reproduce

1. Use Bun and a Chromium browser. From the checkout root run `bun run bench:prepare`; this creates an ignored detached worktree at the exact original commit, installs its frozen lockfile and bundles the original browser engine. Preparation verifies the baseline revision. It prints the browser console command with your checkout path.
2. Run `bun run bench:vfs` with other CPU-heavy work idle. Results replace `benchmarks/results/vfs.json`.
3. Start the normal web dev server with its documented environment. Wait for Vite dependency optimization to settle. Open a same-origin JSON API page (for example `/api/shares/benchmark?view=public`) so app HMR cannot interrupt the benchmark; sharing does not need to be configured. Use the console command printed by preparation. It runs in a temporary DedicatedWorker and leaves credentials/chats unchanged. The only non-fixture fetch is local benchmark metadata.
4. Save `window.__gitinspectBenchmarkResult` as `benchmarks/results/browser-engine.json` (DevTools: `copy(JSON.stringify(window.__gitinspectBenchmarkResult, null, 2))`). Run sequentially after the VFS benchmark, not concurrently. Then `bun run bench:report` regenerates this report from the saved results. `browser-engine-fx.json` comes from running the same steps in a checkout of the fx commit.

No Cloudflare resources are created by these benchmarks. Re-run when tuning the VFS concurrency or changing the agent lifecycle; do not extrapolate the fixture numbers into production latency promises.
