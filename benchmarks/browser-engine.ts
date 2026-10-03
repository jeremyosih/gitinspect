import { createFxAgent, supportsJspi } from "libfx/browser";
import wasmAsset from "libfx/fx-core.wasm?url";
import { Type } from "@sinclair/typebox";
import { createFxFetch, createProviderModel } from "../packages/runtime/src/agent/provider-stream";
import { getModel } from "../packages/runtime/src/models/catalog";
import { summarize } from "./stats";

const iterations = 11;
const warmups = 3;
const answer = Array.from({ length: 16 }, (_, i) => `chunk-${i} `).join("");
const instructions = "Read the repository when asked. Answer concisely.";
const wasm = new URL(wasmAsset, import.meta.url).href;
const legacyUrl = new URL("../.cache/benchmark/pi-browser.js", import.meta.url).href;
const pi = await import(/* @vite-ignore */ legacyUrl);
// Synthetic JWT shape required by Pi's Codex transport. No real account or token.
const access = `e30.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } }))}.fixture`;
const definition = getModel("openai-codex", "gpt-5.4");
const originalModel = pi.getModel("openai-codex", "gpt-5.4");
const parameters = Type.Object({ path: Type.String() });
const nativeFetch = globalThis.fetch;
let calls = 0;
let tools = 0;
let delayMs = 0;
let toolTurn = false;
let sawHistory = false;

async function providerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === wasm) return nativeFetch(input, init);
  const target = new URL(url).searchParams.get("url") ?? url;
  if (!target.includes("chatgpt.com/backend-api/codex/responses"))
    throw new Error(`Unexpected network request: ${url}`);
  calls++;
  const body = await new Response(init?.body).json();
  sawHistory ||= body.input?.some((item: any) => item.type === "function_call_output") ?? false;
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  const tool = toolTurn && calls === 1;
  const item = tool
    ? {
        type: "function_call",
        status: "completed",
        id: "fc_1",
        call_id: "call-1",
        name: "read",
        arguments: JSON.stringify({ path: "README.md" }),
      }
    : {
        type: "message",
        status: "completed",
        id: `msg_${calls}`,
        role: "assistant",
        content: [{ type: "output_text", text: answer, annotations: [] }],
      };
  const parts: unknown[] = [
    {
      type: "response.created",
      response: {
        id: `resp_${calls}`,
        created_at: 1,
        model: "gpt-5.4",
        status: "in_progress",
        output: [],
      },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, ...(tool ? { arguments: "" } : { content: [] }) },
    },
  ];
  if (tool)
    parts.push({
      type: "response.function_call_arguments.delta",
      item_id: "fc_1",
      output_index: 0,
      delta: item.arguments,
    });
  else {
    parts.push({
      type: "response.content_part.added",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
    for (let i = 0; i < 16; i++)
      parts.push({
        type: "response.output_text.delta",
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: `chunk-${i} `,
      });
  }
  parts.push(
    { type: "response.output_item.done", output_index: 0, item },
    {
      type: "response.completed",
      response: {
        id: `resp_${calls}`,
        status: "completed",
        output: [item],
        usage: { input_tokens: 10, output_tokens: 16, input_tokens_details: { cached_tokens: 0 } },
      },
    },
  );
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
const read = async (input: any) => {
  if (input.path !== "README.md") throw new Error("Tool arguments differ");
  tools++;
  return "# Fixture README";
};

type Sample = {
  readyMs: number;
  firstTextMs: number;
  totalMs: number;
  checkpointMs: number;
  calls: number;
  tools: number;
};
async function sample(
  version: "original" | "cleanup",
  scenario: "text" | "tool" | "followup",
  latencyMs: number,
): Promise<Sample> {
  let agent: any;
  let checkpoint: Uint8Array | undefined;
  const sdk =
    version === "cleanup"
      ? await createProviderModel({
          model: definition,
          auth: {
            provider: "openai-codex",
            apiKey: access,
            isOAuth: true,
            storedValue: JSON.stringify({
              access,
              refresh: "fixture-refresh",
              providerId: "openai-codex",
              accountId: "fixture-account",
              expires: Date.now() + 3600000,
            }),
          },
          sessionId: "benchmark",
          thinkingLevel: "off",
          fetch: providerFetch,
        })
      : undefined;
  const create = async () =>
    version === "original"
      ? new pi.Agent({
          initialState: {
            systemPrompt: instructions,
            model: originalModel,
            thinkingLevel: "off",
            tools: [
              {
                name: "read",
                label: "Read",
                description: "Read a file",
                parameters,
                execute: async (_id: string, input: any) => ({
                  content: [{ type: "text", text: await read(input) }],
                  details: {},
                }),
              },
            ],
          },
          getApiKey: async () => access,
          streamFn: pi.streamSimpleOpenAICodexResponses,
          toolExecution: "sequential",
        })
      : createFxAgent({
          wasm,
          apiKey: "host-transport",
          model: "openai-codex/gpt-5.4",
          instructions,
          fetch: createFxFetch(sdk!, definition, "off"),
          checkpoint,
          tools: [
            {
              name: "read",
              description: "Read a file",
              inputSchema: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
              execute: read,
            },
          ],
        });
  let started = 0;
  let firstTextMs = NaN;
  let received = "";
  const run = async () => {
    if (version === "original") {
      const unsubscribe = agent.subscribe((event: any) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          if (Number.isNaN(firstTextMs)) firstTextMs = performance.now() - started;
          received += event.assistantMessageEvent.delta;
        }
      });
      try {
        await agent.prompt("Read README when needed, then answer.");
      } finally {
        unsubscribe();
      }
      if (agent.state.error) throw new Error(agent.state.error);
    } else {
      const turn = agent.prompt("Read README when needed, then answer.");
      for await (const event of turn)
        if (event.type === "text_delta") {
          if (Number.isNaN(firstTextMs)) firstTextMs = performance.now() - started;
          received += event.delta;
        }
      if ((await turn.result).stopReason !== "end_turn") throw new Error("FX turn did not finish");
    }
    if (received !== answer)
      throw new Error(`${version} answer differs: ${JSON.stringify(received)}`);
  };
  const reset = () => {
    calls = 0;
    tools = 0;
    sawHistory = false;
    firstTextMs = NaN;
    received = "";
  };
  reset();
  delayMs = latencyMs;
  toolTurn = scenario === "tool";
  try {
    if (scenario === "followup") {
      toolTurn = true;
      delayMs = 0;
      agent = await create();
      started = performance.now();
      await run();
      if (calls !== 2 || tools !== 1 || !sawHistory)
        throw new Error("Initial tool history differs");
      if (version === "cleanup") {
        checkpoint = await agent.checkpoint();
        await agent.close();
        agent = undefined;
      }
      reset();
      toolTurn = false;
      delayMs = latencyMs;
    }
    started = performance.now();
    if (!agent) agent = await create();
    const readyMs = performance.now() - started;
    await run();
    let checkpointMs = 0;
    // The app checkpoints and closes FX after each turn, while Pi retains its runner.
    if (version === "cleanup") {
      const before = performance.now();
      await agent.checkpoint();
      await agent.close();
      agent = undefined;
      checkpointMs = performance.now() - before;
    }
    const totalMs = performance.now() - started;
    if (
      calls !== (scenario === "tool" ? 2 : 1) ||
      tools !== (scenario === "tool" ? 1 : 0) ||
      (scenario !== "text" && !sawHistory)
    )
      throw new Error(`${version} workload differs`);
    return { readyMs, firstTextMs, totalMs, checkpointMs, calls, tools };
  } finally {
    if (version === "cleanup") await agent?.close();
  }
}

export async function benchmarkBrowserEngine() {
  if (!supportsJspi()) throw new Error("Browser lacks WebAssembly JSPI");
  const revision = await (
    await nativeFetch(new URL("../.cache/benchmark/revision.json", import.meta.url))
  ).json();
  const results = [];
  globalThis.fetch = providerFetch;
  try {
    for (const scenario of ["text", "tool", "followup"] as const)
      for (const latencyMs of [0, 50]) {
        const samples = { original: [] as Sample[], cleanup: [] as Sample[] };
        for (let iteration = -warmups; iteration < iterations; iteration++) {
          for (const version of (iteration % 2
            ? ["cleanup", "original"]
            : ["original", "cleanup"]) as Array<"original" | "cleanup">) {
            const result = await sample(version, scenario, latencyMs);
            if (iteration >= 0) samples[version].push(result);
          }
        }
        const summary = (rows: Sample[]) => ({
          readyMs: summarize(rows.map((row) => row.readyMs)),
          firstTextMs: summarize(rows.map((row) => row.firstTextMs)),
          totalMs: summarize(rows.map((row) => row.totalMs)),
          checkpointMs: summarize(rows.map((row) => row.checkpointMs)),
          calls: rows[0]!.calls,
          tools: rows[0]!.tools,
          samples: rows,
        });
        results.push({
          scenario,
          providerDelayMs: latencyMs,
          original: summary(samples.original),
          cleanup: summary(samples.cleanup),
        });
      }
  } finally {
    globalThis.fetch = nativeFetch;
  }
  return {
    ...revision,
    baseline: "0f30313ef198d1aecc380489cd2429f51d4a9371",
    date: new Date().toISOString(),
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    iterations,
    warmups,
    chunksPerAnswer: 16,
    results,
  };
}
