import * as Schema from "effect/Schema";
import type { RepoRuntime } from "@gitinspect/runtime/repo/repo-types";
import { warningMessageToError } from "@gitinspect/runtime/tools/repo-warnings";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type TruncationResult,
} from "@gitinspect/runtime/tools/truncate";
import type { AppToolDefinition } from "@gitinspect/runtime/tools/types";

const readSchema = Schema.Struct({
  limit: Schema.optionalKey(
    Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
      description: "Maximum number of lines to read",
    }),
  ),
  offset: Schema.optionalKey(
    Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
      description: "1-indexed line number to start reading from",
    }),
  ),
  path: Schema.String.annotate({
    description: "Path to the file to read from the active repository",
  }),
});

export type ReadToolParams = typeof readSchema.Type;

export interface ReadToolDetails {
  path: string;
  resolvedPath: string;
  truncation?: TruncationResult;
  warnings?: string[];
}

function resolveReadPath(runtime: RepoRuntime, path: string): string {
  if (path.startsWith("/")) {
    return path;
  }

  return runtime.fs.resolvePath(runtime.getCwd(), path);
}

function isProbablyBinary(content: string): boolean {
  return content.includes("\u0000");
}

export const readTool = {
  description:
    "Read text file contents from the active repository. Use offset and limit for large files. " +
    `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${Math.floor(DEFAULT_MAX_BYTES / 1024)}KB.`,
  label: "Read",
  name: "read",
  parameters: readSchema,
};

export function createReadTool(
  runtime: RepoRuntime,
  onRepoError?: (error: unknown) => void | Promise<void>,
): AppToolDefinition<ReadToolParams, ReadToolDetails> {
  return {
    ...readTool,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) {
        throw new Error("Read aborted");
      }

      const resolvedPath = resolveReadPath(runtime, params.path);

      let text: string;

      try {
        text = await runtime.fs.readFile(resolvedPath, signal);
      } catch (error) {
        if (onRepoError) {
          await onRepoError(error);
        }

        throw error;
      }

      if (isProbablyBinary(text)) {
        throw new Error(
          "Binary files are not supported by read yet. Use bash to inspect metadata instead.",
        );
      }

      const allLines = text.split("\n");
      const start = params.offset ? Math.max(0, params.offset - 1) : 0;

      if (start >= allLines.length) {
        throw new Error(
          `Offset ${params.offset} is beyond the end of the file (${allLines.length} lines total)`,
        );
      }

      const selectedLines =
        params.limit !== undefined
          ? allLines.slice(start, start + params.limit)
          : allLines.slice(start);
      const selectedContent = selectedLines.join("\n");
      const truncation = truncateHead(selectedContent);
      let output = truncation.content;

      if (truncation.firstLineExceedsLimit) {
        output =
          `Line ${start + 1} exceeds the ${Math.floor(DEFAULT_MAX_BYTES / 1024)}KB read limit. ` +
          "Use bash with a narrower command such as sed or head.";
      } else if (truncation.truncated) {
        const endLine = start + truncation.outputLines;
        output += `\n\n[Showing lines ${start + 1}-${endLine}. Use offset=${endLine + 1} to continue.]`;
      } else if (params.limit !== undefined && start + selectedLines.length < allLines.length) {
        output += `\n\n[More lines remain. Use offset=${start + selectedLines.length + 1} to continue.]`;
      }

      const warnings = runtime.getWarnings();
      if (onRepoError) {
        for (const warning of warnings) {
          await onRepoError(warningMessageToError(warning));
        }
      }

      return {
        content: [{ text: output, type: "text" }],
        details: {
          path: params.path,
          resolvedPath,
          truncation: truncation.truncated ? truncation : undefined,
          warnings,
        },
      };
    },
  };
}
