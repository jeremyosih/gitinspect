import type { DisplayChatMessage } from "@gitinspect/pi/types/chat";
import type { ResolvedRepoSource } from "@gitinspect/db/storage-types";

function formatMessageContent(message: DisplayChatMessage): string {
  if (message.role === "user") {
    if (typeof message.content === "string") return message.content;
    return message.content
      .map((part) => {
        if (part.type === "text") return part.text;
        if (part.type === "image") return "[Image]";
        return "";
      })
      .join("\n");
  }

  if (message.role === "assistant") {
    return message.content
      .map((part) => {
        if (part.type === "text") return part.text;
        if (part.type === "thinking") return `> *Thinking:* ${part.thinking}`;
        if (part.type === "toolCall")
          return `\`Tool call: ${part.name}(${JSON.stringify(part.arguments)})\``;
        return "";
      })
      .join("\n");
  }

  if (message.role === "toolResult") {
    return message.content
      .map((part) => {
        if (part.type === "text") return `\`\`\`\n${part.text}\n\`\`\``;
        if (part.type === "image") return "[Image]";
        return "";
      })
      .join("\n");
  }

  if (message.role === "system") {
    return `*[${message.severity}]* ${message.message}`;
  }

  return "";
}

export function conversationToMarkdown(
  messages: DisplayChatMessage[],
  repoSource?: ResolvedRepoSource,
): string {
  const lines: string[] = [];

  if (repoSource) {
    lines.push(`# ${repoSource.owner}/${repoSource.repo}`);
    if (repoSource.refOrigin !== "default") {
      lines.push(`**Branch:** ${repoSource.ref}`);
    }
  } else {
    lines.push("# Chat");
  }

  lines.push("");
  lines.push(`*Exported on ${new Date().toLocaleString()}*`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const message of messages) {
    if (message.role === "user") {
      lines.push("## User");
    } else if (message.role === "assistant") {
      lines.push("## Assistant");
    } else if (message.role === "toolResult") {
      lines.push("### Tool Result");
    } else if (message.role === "system") {
      lines.push("### System");
    }

    lines.push("");
    lines.push(formatMessageContent(message));
    lines.push("");
  }

  return lines.join("\n");
}
