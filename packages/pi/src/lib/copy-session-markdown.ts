import type { ResolvedRepoSource } from "@gitinspect/db";
import {
  deriveAssistantView,
  getAssistantText,
  getToolResultText,
  getUserText,
} from "@gitinspect/pi/lib/chat-adapter";
import { repoSourceToGitHubUrl } from "@gitinspect/pi/repo/url";
import type { DisplayChatMessage, ToolCall, ToolResultMessage } from "@gitinspect/pi/types/chat";

type MarkdownExportOptions = {
  repoSource?: ResolvedRepoSource;
  sourceUrl?: string;
};

function formatExportedAt(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function buildContextHeader(options: MarkdownExportOptions): string[] {
  if (!options.repoSource) {
    return ["# Chat", `- Exported: ${formatExportedAt(new Date())}`];
  }

  const sourceUrl = options.sourceUrl ?? repoSourceToGitHubUrl(options.repoSource);
  const lines = [`# Chat about ${options.repoSource.owner}/${options.repoSource.repo}`];

  lines.push(`- Repository: \`${options.repoSource.owner}/${options.repoSource.repo}\``);
  lines.push(`- Ref: \`${options.repoSource.ref}\``);
  lines.push(`- Source: ${sourceUrl}`);
  lines.push(`- Exported: ${formatExportedAt(new Date())}`);

  return lines;
}

function getToolStatusLabel(toolResult?: ToolResultMessage): string {
  if (!toolResult) {
    return "Running";
  }

  return toolResult.isError ? "Error" : "Completed";
}

function getToolErrorSummary(toolResult?: ToolResultMessage): string | undefined {
  if (!toolResult?.isError) {
    return undefined;
  }

  const text = getToolResultText(toolResult)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" · ");

  return text || undefined;
}

function formatToolArguments(toolCall: ToolCall, toolResult?: ToolResultMessage): string[] {
  const args = toolCall.arguments;
  const lines: string[] = [];

  if (toolCall.name === "read") {
    if (typeof args.path === "string") {
      lines.push(`   path: ${args.path}`);
    }

    if (typeof args.offset === "number") {
      lines.push(`   offset: ${String(args.offset)}`);
    }

    if (typeof args.limit === "number") {
      lines.push(`   limit: ${String(args.limit)}`);
    }

    const details = toolResult?.details;
    if (
      details &&
      typeof details === "object" &&
      "resolvedPath" in details &&
      typeof details.resolvedPath === "string"
    ) {
      lines.push(`   resolved: ${details.resolvedPath}`);
    }
  } else if (toolCall.name === "bash") {
    if (typeof args.command === "string") {
      lines.push(`   command: ${args.command}`);
    }

    const details = toolResult?.details;
    if (
      details &&
      typeof details === "object" &&
      "cwd" in details &&
      typeof details.cwd === "string"
    ) {
      lines.push(`   cwd: ${details.cwd}`);
    }
  } else {
    lines.push(`   args: ${JSON.stringify(args)}`);
  }

  const errorSummary = getToolErrorSummary(toolResult);
  if (errorSummary) {
    lines.push(`   error: ${errorSummary}`);
  }

  return lines;
}

function formatToolExecutions(
  toolExecutions: ReturnType<typeof deriveAssistantView>["toolExecutions"],
): string[] {
  if (toolExecutions.length === 0) {
    return [];
  }

  return toolExecutions.flatMap(({ toolCall, toolResult }, index) => [
    `${index + 1}. ${toolCall.name} — ${getToolStatusLabel(toolResult)}`,
    ...formatToolArguments(toolCall, toolResult),
  ]);
}

export function messagesToMarkdown(
  messages: readonly DisplayChatMessage[],
  options: MarkdownExportOptions = {},
): string {
  const parts: string[] = [buildContextHeader(options).join("\n")];

  for (const [index, message] of messages.entries()) {
    switch (message.role) {
      case "user":
        parts.push(`## User\n\n${getUserText(message)}`);
        break;
      case "assistant": {
        const text = getAssistantText(message);
        const view = deriveAssistantView(message, messages.slice(index + 1));
        const toolLines = formatToolExecutions(view.toolExecutions);
        const section: string[] = ["## Assistant"];

        if (text.trim()) {
          section.push("", text);
        }

        if (toolLines.length > 0) {
          section.push("", "### Tools", "", ...toolLines);
        }

        if (section.length > 1) {
          parts.push(section.join("\n"));
        }
        break;
      }
      case "system":
        parts.push(`> **System:** ${message.message}`);
        break;
      case "toolResult":
        break;
    }
  }

  return parts.join("\n\n---\n\n") + "\n";
}

export async function copySessionToClipboard(
  messages: readonly DisplayChatMessage[],
  options: MarkdownExportOptions = {},
): Promise<void> {
  const markdown = messagesToMarkdown(messages, options);
  await navigator.clipboard.writeText(markdown);
}
