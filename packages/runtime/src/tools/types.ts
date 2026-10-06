import type * as Schema from "effect/Schema";
import type { ImageContent, TextContent } from "@gitinspect/runtime/types/chat";

export interface AppToolResult<TDetails = undefined> {
  content: Array<TextContent | ImageContent>;
  details: TDetails;
}

export interface AppToolDefinition<TParameters = unknown, TDetails = undefined> {
  description: string;
  execute: (
    toolCallId: string,
    params: TParameters,
    signal?: AbortSignal,
    onUpdate?: (partial: AppToolResult<TDetails>) => void,
  ) => Promise<AppToolResult<TDetails>>;
  label: string;
  name: string;
  parameters: Schema.Codec<TParameters, unknown, never, never>;
}
