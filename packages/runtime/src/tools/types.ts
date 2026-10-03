import { Value } from "@sinclair/typebox/value";
import type { FxTool } from "../agent/fx-types";
import type { Static, TSchema } from "@sinclair/typebox";
import type { ImageContent, TextContent } from "@gitinspect/runtime/types/chat";

export interface AppToolResult<TDetails = undefined> {
  content: Array<TextContent | ImageContent>;
  details: TDetails;
}

export interface AppToolDefinition<TParameters extends TSchema = TSchema, TDetails = undefined> {
  description: string;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: (partial: AppToolResult<TDetails>) => void,
  ) => Promise<AppToolResult<TDetails>>;
  label: string;
  name: string;
  parameters: TParameters;
}

export interface ProviderToolDefinition {
  description: string;
  name: string;
  parameters: TSchema;
}

export function toProviderToolDefinition<TParameters extends TSchema, TDetails = undefined>(
  tool: AppToolDefinition<TParameters, TDetails>,
): ProviderToolDefinition {
  return {
    description: tool.description,
    name: tool.name,
    parameters: tool.parameters,
  };
}

export function toAgentTool<TParameters extends TSchema, TDetails = undefined>(
  tool: AppToolDefinition<TParameters, TDetails>,
  onResult?: (name: string, input: unknown, result: AppToolResult<TDetails>) => void,
): FxTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
    async execute(input, { signal }) {
      if (!Value.Check(tool.parameters, input))
        throw new Error(`Invalid ${tool.name} tool arguments`);
      const result = await tool.execute(tool.name, input as Static<TParameters>, signal);
      onResult?.(tool.name, input, result);
      return {
        type: "libfx.tool-result",
        text: result.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
        images: result.content.filter((part) => part.type === "image"),
        isError: false,
      };
    },
  };
}
