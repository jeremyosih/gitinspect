"use client"

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool"
import type { ToolCall, ToolResultMessage } from "@/types/chat"

interface BashDetails {
  command: string
  cwd: string
  exitCode: number
}

interface ReadDetails {
  path: string
  resolvedPath: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isBashDetails(value: unknown): value is BashDetails {
  return (
    isObject(value) &&
    typeof value.command === "string" &&
    typeof value.cwd === "string" &&
    typeof value.exitCode === "number"
  )
}

function isReadDetails(value: unknown): value is ReadDetails {
  return (
    isObject(value) &&
    typeof value.path === "string" &&
    typeof value.resolvedPath === "string"
  )
}

function getToolResultText(message: ToolResultMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function renderToolResultBody(message: ToolResultMessage) {
  const text = getToolResultText(message)
  const hasReadDetails = isReadDetails(message.details)
  const hasBashDetails = isBashDetails(message.details)

  if (!text && !hasReadDetails && !hasBashDetails) {
    return null
  }

  return (
    <div className="space-y-3 text-xs">
      {hasReadDetails ? (
        <div className="text-muted-foreground">
          {message.details.path} → {message.details.resolvedPath}
        </div>
      ) : null}

      {hasBashDetails ? (
        <div className="space-y-1 text-muted-foreground">
          <div>
            {message.details.cwd} · exit {message.details.exitCode}
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-3 font-mono text-foreground/80">
            {message.details.command}
          </pre>
        </div>
      ) : null}

      {text ? (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-background/60 p-3 leading-5">
          {text}
        </pre>
      ) : null}
    </div>
  )
}

function getToolState(toolResult?: ToolResultMessage) {
  if (!toolResult) {
    return "input-available" as const
  }

  return toolResult.isError
    ? ("output-error" as const)
    : ("output-available" as const)
}

export function ToolExecution(props: {
  toolCall: ToolCall
  toolResult?: ToolResultMessage
}) {
  const state = getToolState(props.toolResult)
  const output = props.toolResult ? renderToolResultBody(props.toolResult) : undefined

  // Remount when a result arrives so `defaultOpen` applies. Radix Collapsible only
  // reads `defaultOpen` on first mount; otherwise the block stays open after stream end.
  return (
    <Tool
      key={props.toolResult ? "resolved" : "pending"}
      defaultOpen={state !== "output-available"}
    >
      <ToolHeader
        state={state}
        toolName={props.toolCall.name}
        type="dynamic-tool"
      />
      <ToolContent>
        <ToolInput input={props.toolCall.arguments} />
        <ToolOutput
          errorText={undefined}
          isError={props.toolResult?.isError}
          output={output}
        />
      </ToolContent>
    </Tool>
  )
}
