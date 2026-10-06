import { Effect, Fiber, Layer, ManagedRuntime, Schema, Stream } from "effect";
import * as Pi from "effect-pi-durable";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { MessageRow } from "@gitinspect/db";
import {
  assistantMessageOf,
  seedTranscript,
  toolResultMessageOf,
} from "../packages/runtime/src/agent/transcript-entries";
import { getModel } from "../packages/runtime/src/models/catalog";
import { summarize } from "./stats";

const iterations = 11;
const warmups = 3;
const answer = Array.from({ length: 16 }, (_, i) => `chunk-${i} `).join("");
const instructions = "Read the repository when asked. Answer concisely.";
const prompt = "Read README when needed, then answer.";
const legacyUrl = new URL("../.cache/benchmark/pi-browser.js", import.meta.url).href;
const pi = await import(/* @vite-ignore */ legacyUrl);
// Synthetic JWT shape required by Pi's Codex transport. No real account or token.
const access = `e30.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } }))}.fixture`;
const { free: _free, ...definition } = getModel("openai-codex", "gpt-5.4");
const originalModel = pi.getModel("openai-codex", "gpt-5.4");
const nativeFetch = globalThis.fetch;
let calls = 0;
let tools = 0;
let delayMs = 0;
let toolTurn = false;
let sawHistory = false;

async function providerFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
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
const read = async (input: { path: string }) => {
  if (input.path !== "README.md") throw new Error("Tool arguments differ");
  tools++;
  return "# Fixture README";
};

/** One agent implementation. `turn` reports the answer and when its first text reached the host. */
type Engine = {
  turn(started: number): Promise<{ text: string; firstTextMs: number }>;
  /** A new engine holding this one's conversation, as after a worker restart. */
  restore(): Promise<Engine>;
  close(): Promise<void>;
};

function createOriginal(messages: unknown[] = []): Engine {
  const agent = new pi.Agent({
    initialState: {
      systemPrompt: instructions,
      model: originalModel,
      thinkingLevel: "off",
      messages,
      tools: [
        {
          name: "read",
          label: "Read",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          execute: async (_id: string, input: { path: string }) => ({
            content: [{ type: "text", text: await read(input) }],
            details: {},
          }),
        },
      ],
    },
    getApiKey: async () => access,
    streamFn: pi.streamSimpleOpenAICodexResponses,
    toolExecution: "sequential",
  });
  return {
    async turn(started) {
      let firstTextMs = NaN;
      let text = "";
      const unsubscribe = agent.subscribe((event: any) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          if (Number.isNaN(firstTextMs)) firstTextMs = performance.now() - started;
          text += event.assistantMessageEvent.delta;
        }
      });
      try {
        await agent.prompt(prompt);
      } finally {
        unsubscribe();
      }
      if (agent.state.error) throw new Error(agent.state.error);
      return { text, firstTextMs };
    },
    restore: async () => createOriginal(structuredClone(agent.state.messages)),
    close: async () => {},
  };
}

// The app's stack: Pi Durable through effect-pi-durable, tools declared with Effect Schema.
const Read = Pi.Tool.make({
  name: "read",
  description: "Read a file",
  parameters: Schema.Struct({ path: Schema.String }),
  success: Schema.String,
  execute: (input) => Effect.promise(() => read(input)),
});
const Benchmark = Pi.Extension.make({
  name: "benchmark",
  tools: [Read],
  sections: [Pi.Section.make("benchmark", () => Effect.succeed(instructions), { tag: false })],
});
const models = createModels();
models.setProvider(
  createProvider({
    id: "openai-codex",
    auth: { apiKey: { name: "fixture", resolve: async () => ({ auth: { apiKey: access } }) } },
    // SAFETY: The catalog entry is Pi AI's chat model shape.
    models: [definition as Model<Api>],
    api: openAICodexResponsesApi(),
  }),
);
const textOf = (message: AssistantMessage | undefined) =>
  (message?.content ?? []).map((block) => (block.type === "text" ? block.text : "")).join("");

async function createCleanup(transcript: MessageRow[] = []): Promise<Engine> {
  const runtime = ManagedRuntime.make(
    Pi.Harness.layer({
      extensions: [Benchmark],
      settings: { stream: { transport: "sse" }, toolExecution: "sequential" },
    }).pipe(
      Layer.provide(
        Layer.mergeAll(Pi.Storage.memory, Pi.Models.fromPiAi(models), Pi.ExecutionEnv.none),
      ),
    ),
  );
  const conversation = await runtime.runPromise(
    Effect.gen(function* () {
      const harness = yield* Pi.Harness;

      return yield* harness.root({
        agent: { model: { provider: "openai-codex", modelId: "gpt-5.4" }, thinkingLevel: "off" },
        init: seedTranscript(transcript),
      });
    }),
  );
  const assistants = (entries: readonly Pi.EntryRecord[]) =>
    entries.flatMap((entry) => (entry.model?.[0]?.role === "assistant" ? [entry.model[0]] : []));
  return {
    turn: (started) =>
      runtime.runPromise(
        Effect.gen(function* () {
          const before = (yield* conversation.context()).entries.length;
          let firstTextMs = NaN;
          // The host sees text when a commit carries it, as the app's transcript writer does.
          const watcher = yield* conversation.views.pipe(
            Stream.runForEach((view) =>
              Effect.sync(() => {
                const live: { generation?: { message?: AssistantMessage } } | undefined =
                  view.docs["pi.live"];
                const visible =
                  textOf(live?.generation?.message) ||
                  textOf(assistants(view.entries.slice(before)).at(-1));
                if (visible && Number.isNaN(firstTextMs)) firstTextMs = performance.now() - started;
              }),
            ),
            Effect.forkChild,
          );
          const submission = yield* conversation.submit({ type: "input", content: prompt });
          const receipt = yield* submission.wait;
          yield* Fiber.interrupt(watcher);
          if (receipt.status !== "done")
            throw new Error(`Pi turn ended ${JSON.stringify(receipt)}`);
          const text = textOf(assistants((yield* conversation.context()).entries).at(-1));
          if (Number.isNaN(firstTextMs)) firstTextMs = performance.now() - started;
          return { text, firstTextMs };
        }),
      ),
    async restore() {
      const { entries } = await runtime.runPromise(conversation.context());
      // The transcript rows the app persists, which a new worker starts from.
      const rows = entries.flatMap((entry, order): MessageRow[] => {
        const message = entry.model?.[0];
        const row = { sessionId: "benchmark", order, status: "completed" as const };
        if (message?.role === "user")
          return [{ ...row, id: `m${order}`, role: "user", content: prompt, timestamp: order }];
        if (message?.role === "assistant")
          return [{ ...row, ...assistantMessageOf(message, `m${order}`) }];
        if (message?.role === "toolResult")
          return [{ ...row, ...toolResultMessageOf(message, `m${order}`) }];
        return [];
      });
      await runtime.dispose();
      return createCleanup(rows);
    },
    close: () => runtime.dispose(),
  };
}

const scenarios = ["text", "tool", "followup", "restore"] as const;
type Scenario = (typeof scenarios)[number];
type Sample = {
  readyMs: number;
  firstTextMs: number;
  totalMs: number;
  calls: number;
  tools: number;
};
async function sample(
  version: "original" | "cleanup",
  scenario: Scenario,
  latencyMs: number,
): Promise<Sample> {
  const create = () => (version === "original" ? createOriginal() : createCleanup());
  const run = async (engine: Engine, started: number) => {
    const result = await engine.turn(started);
    if (result.text !== answer)
      throw new Error(`${version} answer differs: ${JSON.stringify(result.text)}`);
    return result.firstTextMs;
  };
  const reset = () => {
    calls = 0;
    tools = 0;
    sawHistory = false;
  };
  reset();
  delayMs = latencyMs;
  toolTurn = scenario === "tool";
  let engine: Engine | undefined;
  try {
    if (scenario === "followup" || scenario === "restore") {
      // An untimed tool turn first, so the timed turn carries tool history.
      toolTurn = true;
      delayMs = 0;
      engine = await create();
      await run(engine, performance.now());
      if (calls !== 2 || tools !== 1 || !sawHistory)
        throw new Error("Initial tool history differs");
      reset();
      toolTurn = false;
      delayMs = latencyMs;
    }
    const started = performance.now();
    // Follow-up keeps the engine, as within one worker; restore builds a new one from the transcript.
    if (scenario === "restore") engine = await engine!.restore();
    engine ??= await create();
    const readyMs = performance.now() - started;
    const firstTextMs = await run(engine, started);
    const totalMs = performance.now() - started;
    if (
      calls !== (scenario === "tool" ? 2 : 1) ||
      tools !== (scenario === "tool" ? 1 : 0) ||
      (scenario !== "text" && !sawHistory)
    )
      throw new Error(`${version} workload differs`);
    return { readyMs, firstTextMs, totalMs, calls, tools };
  } finally {
    await engine?.close();
  }
}

export async function benchmarkBrowserEngine() {
  const revision = await (
    await nativeFetch(new URL("../.cache/benchmark/revision.json", import.meta.url))
  ).json();
  const results = [];
  globalThis.fetch = providerFetch;
  try {
    for (const scenario of scenarios)
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
