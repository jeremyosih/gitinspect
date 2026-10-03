import type { ToolResultMessage } from "@gitinspect/runtime/types/chat";
import { Badge } from "@gitinspect/ui/components/badge";

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

export function ToolResultBubble(props: { message: ToolResultMessage }) {
  const text = props.message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  return (
    <div className="flex flex-col gap-2 border-l border-foreground/10 pl-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>Tool result</span>
        <Badge className="rounded-none" variant="outline">
          {props.message.toolName}
        </Badge>
        {props.message.isError ? (
          <Badge className="rounded-none" variant="destructive">
            Error
          </Badge>
        ) : null}
      </div>
      {isReadDetails(props.message.details) ? (
        <div className="text-xs text-muted-foreground">
          {props.message.details.path} → {props.message.details.resolvedPath}
        </div>
      ) : null}
      {isBashDetails(props.message.details) ? (
        <div className="text-xs text-muted-foreground">
          {props.message.details.cwd} · exit {props.message.details.exitCode}
          <div className="mt-1 font-mono text-foreground/80">{props.message.details.command}</div>
        </div>
      ) : null}
      <pre className="overflow-x-auto whitespace-pre-wrap break-words bg-card/60 p-3 text-xs leading-5">
        {text || "(no output)"}
      </pre>
    </div>
  );
}
