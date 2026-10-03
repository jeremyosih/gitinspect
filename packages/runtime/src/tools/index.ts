import { Effect, Semaphore } from "effect";
import type { AppToolResult } from "./types";
import type { RepoRuntime } from "@gitinspect/runtime/repo/repo-types";
import { createBashTool } from "@gitinspect/runtime/tools/bash";
import { createReadTool } from "@gitinspect/runtime/tools/read";
import { toAgentTool, toProviderToolDefinition } from "@gitinspect/runtime/tools/types";

export function createRepoTools(
  runtime: RepoRuntime,
  options?: {
    onRepoError?: (error: unknown) => void | Promise<void>;
    onToolResult?: (name: string, input: unknown, result: AppToolResult<unknown>) => void;
  },
) {
  const read = createReadTool(runtime, options?.onRepoError);
  const bash = createBashTool(runtime, options?.onRepoError);
  const definitions = [read, bash];

  const execution = Semaphore.makeUnsafe(1);
  const tools = [
    toAgentTool(read, options?.onToolResult),
    toAgentTool(bash, options?.onToolResult),
  ].map((tool) => ({
    ...tool,
    execute: (input: unknown, context: { signal: AbortSignal }) =>
      Effect.runPromise(
        Effect.promise(() => tool.execute(input, context)).pipe(execution.withPermit),
      ),
  }));
  return {
    agentTools: tools,
    definitions,
    providerTools: [toProviderToolDefinition(read), toProviderToolDefinition(bash)],
  };
}
