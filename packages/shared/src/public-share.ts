import { z } from "zod";
import type { MessageRow, ResolvedRepoSource } from "./types/storage";

export const MAX_SHARE_BYTES = 2 * 1024 * 1024;
export const ShareIdSchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().max(MAX_SHARE_BYTES);
const ref = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("commit"), sha: z.string().min(1) }),
  z.object({
    kind: z.literal("branch"),
    name: z.string().min(1),
    apiRef: z.string().startsWith("heads/"),
    fullRef: z.string().startsWith("refs/heads/"),
  }),
  z.object({
    kind: z.literal("tag"),
    name: z.string().min(1),
    apiRef: z.string().startsWith("tags/"),
    fullRef: z.string().startsWith("refs/tags/"),
  }),
]);
const repo = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  ref: z.string().min(1),
  refOrigin: z.enum(["default", "explicit"]),
  resolvedRef: ref,
});
const textPart = z.object({ type: z.literal("text"), text });
const imagePart = z.object({
  type: z.literal("image"),
  data: text,
  mimeType: z.string().startsWith("image/"),
});
const toolCall = z.object({
  type: z.literal("toolCall"),
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.json()),
});
const thinking = z.object({
  type: z.literal("thinking"),
  thinking: text,
  redacted: z.boolean().optional(),
});
const base = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative(),
  sessionId: ShareIdSchema,
  timestamp: z.number().finite(),
  status: z.enum(["aborted", "completed", "error", "streaming"]),
});
const usage = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  totalTokens: z.number(),
  cost: z.object({
    input: z.number(),
    output: z.number(),
    cacheRead: z.number(),
    cacheWrite: z.number(),
    total: z.number(),
  }),
});
export const ShareMessageSchema = z.discriminatedUnion("role", [
  base.extend({
    role: z.literal("user"),
    content: z.union([text, z.array(z.union([textPart, imagePart]))]),
  }),
  base.extend({
    role: z.literal("assistant"),
    content: z.array(z.union([textPart, thinking, toolCall])),
    api: z.string(),
    provider: z.string(),
    model: z.string(),
    usage,
    stopReason: z.enum(["stop", "length", "toolUse", "error", "aborted"]),
    errorMessage: text.optional(),
  }),
  base.extend({
    role: z.literal("toolResult"),
    content: z.array(z.union([textPart, imagePart])),
    toolCallId: z.string(),
    toolName: z.string(),
    parentAssistantId: z.string(),
    isError: z.boolean(),
    details: z.json().optional(),
  }),
]);
const sessionMetadata = z.object({
  id: ShareIdSchema,
  title: z.string().max(500),
  createdAt: z.string(),
  updatedAt: z.string(),
  sourceUrl: z.url().optional(),
  repoSource: repo.optional(),
});
export const SharePublishSchema = z.object({
  session: sessionMetadata,
  messages: z
    .array(z.union([ShareMessageSchema, z.object({ role: z.literal("system") })]))
    .max(1000),
});
export const PublicShareSchema = z.object({
  session: sessionMetadata.extend({ publishedAt: z.string() }),
  messages: z.array(ShareMessageSchema).max(1000),
});
export type PublicSessionRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  repoSource?: ResolvedRepoSource;
  sourceUrl?: string;
};
export type PublicShareMessageRow = Extract<
  MessageRow,
  { role: "assistant" | "toolResult" | "user" }
>;
export type PublicShareMessageRole = PublicShareMessageRow["role"];
export type PublicMessageRecord = PublicShareMessageRow;
export type PublicSessionSnapshot = {
  session: PublicSessionRecord;
  messages: PublicMessageRecord[];
};

/** Bound bodies while streaming, including requests with no Content-Length header. */
export async function readShareBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > MAX_SHARE_BYTES)
    throw new RangeError("Shared transcript exceeds 2 MiB");
  const reader = request.body?.getReader();
  if (!reader) throw new TypeError("Missing share body");
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_SHARE_BYTES) {
        await reader.cancel();
        throw new RangeError("Shared transcript exceeds 2 MiB");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
