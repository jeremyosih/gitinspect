import { describe, it, expect } from "vitest";
import { createFxAgent } from "libfx/node";
import { createFxFetch, createProviderModel } from "../packages/runtime/src/agent/provider-stream";
import { getModel } from "../packages/runtime/src/models/catalog";
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider";

describe("real fx engine", () => {
  it("executes a tool through the real ChatGPT Responses SDK adapter", async () => {
    let requests = 0;
    const bodies: any[] = [];
    const definition = getModel("openai-codex", "gpt-5.4");
    const model = await createProviderModel({
      model: definition,
      auth: {
        apiKey: "fixture-access",
        provider: "openai-codex",
        isOAuth: true,
        storedValue: JSON.stringify({
          access: "fixture-access",
          refresh: "fixture-refresh",
          accountId: "fixture-account",
          expires: Date.now() + 600000,
          providerId: "openai-codex",
        }),
      },
      sessionId: "fixture-session",
      thinkingLevel: "off",
      async fetch(_url, init) {
        bodies.push(JSON.parse(String(init?.body)));
        requests++;
        const item =
          requests === 1
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
                id: "msg_2",
                role: "assistant",
                content: [{ type: "output_text", text: "Read successfully.", annotations: [] }],
              };
        const parts = [
          {
            type: "response.created",
            response: { id: `resp_${requests}`, created_at: 1, model: definition.id },
          },
          { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "" } },
          requests === 1
            ? {
                type: "response.function_call_arguments.delta",
                item_id: "fc_1",
                output_index: 0,
                delta: item.arguments,
              }
            : {
                type: "response.output_text.delta",
                item_id: "msg_2",
                output_index: 0,
                content_index: 0,
                delta: "Read successfully.",
              },
          { type: "response.output_item.done", output_index: 0, item },
          {
            type: "response.completed",
            response: {
              id: `resp_${requests}`,
              status: "completed",
              output: [item],
              usage: { input_tokens: 5, output_tokens: 3 },
            },
          },
        ];
        return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(""), {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    const agent = await createFxAgent({
      apiKey: "host-transport",
      model: `${definition.provider}/${definition.id}`,
      fetch: createFxFetch(model, definition, "off"),
      instructions: "Inspect repositories.",
      tools: [
        {
          name: "read",
          description: "Read a file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          async execute(input) {
            expect(input).toEqual({ path: "README.md" });
            return "# Fixture README";
          },
        },
      ],
    });
    try {
      const turn = agent.prompt("Read README");
      const events = [];
      for await (const event of turn) events.push(event);
      expect((await turn.result).stopReason).toBe("end_turn");
      expect(requests).toBe(2);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "tool_end", content: "# Fixture README" }),
          expect.objectContaining({ type: "text_delta", delta: "Read successfully." }),
        ]),
      );
      expect(bodies[1].input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "function_call_output",
            call_id: "call-1",
            output: "# Fixture README",
          }),
        ]),
      );
    } finally {
      await agent.close();
    }
  }, 30000);

  it("runs a host tool and resumes from checkpoint without replaying the first turn", async () => {
    let requests = 0;
    let tools = 0;
    const prompts: unknown[] = [];
    const model = {
      specificationVersion: "v4",
      provider: "test",
      modelId: "test",
      supportedUrls: {},
      async doStream(options: any) {
        prompts.push(options.prompt);
        requests++;
        const parts: LanguageModelV4StreamPart[] =
          requests === 1
            ? [
                {
                  type: "tool-call",
                  toolCallId: "call-1",
                  toolName: "read",
                  input: JSON.stringify({ path: "README.md" }),
                },
                {
                  type: "finish",
                  finishReason: { unified: "tool-calls", raw: "tool_calls" },
                  usage: { inputTokens: { total: 3 }, outputTokens: { total: 2 } },
                },
              ]
            : [
                { type: "text-start", id: "text-1" },
                {
                  type: "text-delta",
                  id: "text-1",
                  delta: requests === 2 ? "Repository read." : "Continued.",
                },
                { type: "text-end", id: "text-1" },
                {
                  type: "finish",
                  finishReason: { unified: "stop", raw: "stop" },
                  usage: { inputTokens: { total: 5 }, outputTokens: { total: 3 } },
                },
              ];
        return {
          stream: new ReadableStream({
            start(controller) {
              for (const part of parts) controller.enqueue(part);
              controller.close();
            },
          }),
        };
      },
    } as LanguageModelV4;
    const definition = getModel("openai", "gpt-5.4");
    const options = {
      apiKey: "test",
      model: `${definition.provider}/${definition.id}`,
      fetch: createFxFetch(model, definition, "off"),
      instructions: "Inspect the repo.",
      tools: [
        {
          name: "read",
          description: "Read a repository file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          async execute() {
            tools++;
            return "# README";
          },
        },
      ],
    };
    const agent = await createFxAgent(options);
    let checkpoint: Uint8Array;
    try {
      const turn = agent.prompt("Inspect README");
      const events = [];
      for await (const event of turn) events.push(event);
      const result = await turn.result;
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "tool_start", name: "read" }),
          expect.objectContaining({ type: "tool_end", content: "# README" }),
          expect.objectContaining({ type: "text_delta", delta: "Repository read." }),
        ]),
      );
      expect(result.stopReason).toBe("end_turn");
      expect(tools).toBe(1);
      checkpoint = await agent.checkpoint();
    } finally {
      await agent.close();
    }
    const resumed = await createFxAgent({ ...options, checkpoint });
    try {
      const turn = resumed.prompt("Continue");
      for await (const _ of turn) {
      }
      expect((await turn.result).stopReason).toBe("end_turn");
      expect(requests).toBe(3);
      expect(JSON.stringify(prompts.at(-1))).toContain("README");
    } finally {
      await resumed.close();
    }
  }, 30000);
});
