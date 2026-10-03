"use client";

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@gitinspect/ui/components/ai-elements/tool";
import {
  isUserAbortError,
  USER_ABORT_NOTICE_MESSAGE,
} from "@gitinspect/runtime/agent/runtime-errors";
import type { ToolCall, ToolResultMessage } from "@gitinspect/runtime/types/chat";

interface BashDetails {
  command: string;
  cwd: string;
  exitCode: number;
}

interface ReadDetails {
  path: string;
  resolvedPath: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBashDetails(value: unknown): value is BashDetails {
  return (
    isObject(value) &&
    typeof value.command === "string" &&
    typeof value.cwd === "string" &&
    typeof value.exitCode === "number"
  );
}

function isReadDetails(value: unknown): value is ReadDetails {
  return (
    isObject(value) && typeof value.path === "string" && typeof value.resolvedPath === "string"
  );
}

function getToolResultText(message: ToolResultMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function getDisplayToolResultText(message: ToolResultMessage): string {
  const text = getToolResultText(message);
  if (message.isError && isUserAbortError(new Error(text))) {
    return USER_ABORT_NOTICE_MESSAGE;
  }
  return text;
}

function renderToolResultBody(message: ToolResultMessage) {
  const text = getDisplayToolResultText(message);
  const details = message.details;
  const hasReadDetails = isReadDetails(details);
  const hasBashDetails = isBashDetails(details);

  if (!text && !hasReadDetails && !hasBashDetails) {
    return null;
  }

  return (
    <div className="space-y-3 text-xs">
      {hasReadDetails ? (
        <div className="text-muted-foreground">
          {details.path} → {details.resolvedPath}
        </div>
      ) : null}

      {hasBashDetails ? (
        <div className="space-y-1 text-muted-foreground">
          <div>
            {details.cwd} · exit {details.exitCode}
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-3 font-mono text-foreground/80">
            {details.command}
          </pre>
        </div>
      ) : null}

      {text ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-3 leading-5">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

function getToolState(toolResult?: ToolResultMessage) {
  if (!toolResult) {
    return "input-available" as const;
  }

  if (!toolResult.isError) {
    return "output-available" as const;
  }

  const text = getToolResultText(toolResult);
  if (isUserAbortError(new Error(text))) {
    return "output-available" as const;
  }

  return "output-error" as const;
}

export function ToolExecution(props: { toolCall: ToolCall; toolResult?: ToolResultMessage }) {
  const state = getToolState(props.toolResult);
  const output = props.toolResult ? renderToolResultBody(props.toolResult) : undefined;

  // Remount when a result arrives so `defaultOpen` applies. Radix Collapsible only
  // reads `defaultOpen` on first mount; otherwise the block stays open after stream end.
  return (
    <Tool
      key={props.toolResult ? "resolved" : "pending"}
      defaultOpen={state !== "output-available"}
    >
      <ToolHeader state={state} toolName={props.toolCall.name} type="dynamic-tool" />
      <ToolContent>
        <ToolInput input={props.toolCall.arguments} />
        <ToolOutput errorText={undefined} isError={props.toolResult?.isError} output={output} />
      </ToolContent>
    </Tool>
  );
}
