import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Pi from "effect-pi-durable";
import type { RepoRuntime } from "@gitinspect/runtime/repo/repo-types";
import { bashTool, createBashTool } from "@gitinspect/runtime/tools/bash";
import { createReadTool, readTool } from "@gitinspect/runtime/tools/read";
import type { AppToolDefinition } from "@gitinspect/runtime/tools/types";

/** The repository snapshot a session's tools inspect, and where they report repository failures. */
export class RepoWorkspace extends Context.Service<
  RepoWorkspace,
  {
    readonly runtime: RepoRuntime;
    readonly onRepoError: (error: unknown) => void | Promise<void>;
  }
>()("gitinspect/RepoWorkspace") {}

const RepoToolOutput = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
  details: Schema.optionalKey(Schema.MutableJson),
  isError: Schema.Boolean,
});

function textOf(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("\n");
}

function repoTool<TParameters, TDetails extends object>(
  create: (
    runtime: RepoRuntime,
    onRepoError: (error: unknown) => void | Promise<void>,
  ) => AppToolDefinition<TParameters, TDetails>,
  shape: Pick<AppToolDefinition<TParameters, TDetails>, "description" | "name" | "parameters">,
) {
  return Pi.Tool.make({
    name: shape.name,
    description: shape.description,
    parameters: shape.parameters,
    success: RepoToolOutput,
    execute: (params, call) =>
      Effect.gen(function* () {
        const workspace = yield* RepoWorkspace;
        const tool = create(workspace.runtime, workspace.onRepoError);
        const result = yield* Effect.tryPromise({
          try: (signal) => tool.execute(call.callId, params, signal),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        });

        return {
          content: [{ type: "text" as const, text: textOf(result.content) }],
          // Details are plain data; the round trip drops their undefined optional fields.
          details: Schema.decodeUnknownSync(Schema.MutableJson)(
            JSON.parse(JSON.stringify(result.details)),
          ),
          isError: false,
        };
      }).pipe(
        // The model reads a tool failure as that call's result, as the tools' messages intend.
        Effect.catch((error: Error) =>
          Effect.succeed({
            content: [{ type: "text" as const, text: error.message }],
            isError: true,
          }),
        ),
      ),
    toResult: ({ content, details, isError }) => ({
      content: content.map((part) => ({ ...part })),
      ...(details === undefined ? {} : { details }),
      isError,
    }),
  });
}

export const ReadTool = repoTool(createReadTool, readTool);
export const BashTool = repoTool(createBashTool, bashTool);

/** Read-only repository tools; each call resolves the session's {@link RepoWorkspace}. */
export const RepoTools = Pi.Extension.make({ name: "repo", tools: [ReadTool, BashTool] });
