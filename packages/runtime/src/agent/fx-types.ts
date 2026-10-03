import type { JsonValue } from "../types/common";
export type FxEvent =
  | { type: "text_delta" | "reasoning_delta"; delta: string }
  | {
      type: "tool_start";
      id: string;
      name: string;
      input?: Record<string, JsonValue>;
      inputPreview?: string;
      inputTruncated?: boolean;
    }
  | { type: "tool_end"; id: string; name: string; content?: string; isError: boolean }
  | { type: "user_message"; text: string };
export interface FxUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}
export interface FxTurn extends AsyncIterable<FxEvent> {
  cancel(): void;
  result: Promise<{ stopReason: string; usage: FxUsage }>;
}
export interface FxTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown, context: { signal: AbortSignal }): Promise<unknown>;
}
export interface FxAgent {
  prompt(input: string | unknown[]): FxTurn;
  checkpoint(): Promise<Uint8Array>;
  close(): Promise<void>;
}
export interface FxOptions {
  wasm?: string;
  apiKey: string;
  model: string;
  instructions: string;
  tools: FxTool[];
  checkpoint?: Uint8Array;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}
