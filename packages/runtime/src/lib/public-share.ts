import type {
  MessageRow,
  PublicMessageRecord,
  PublicSessionRecord,
  PublicShareMessageRow,
  SessionData,
} from "@gitinspect/db";
import { messagesToMarkdown } from "@gitinspect/runtime/lib/copy-session-markdown";
import type { DisplayChatMessage } from "@gitinspect/runtime/types/chat";

const MAX_FORK_MARKDOWN_CHARS = 24_000;
const FORK_MARKDOWN_HEAD_CHARS = 4_000;

function comparePublicMessages(
  left: Pick<PublicShareMessageRow, "id" | "order" | "timestamp">,
  right: Pick<PublicShareMessageRow, "id" | "order" | "timestamp">,
): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }

  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp;
  }

  return left.id.localeCompare(right.id);
}

function isPublicShareMessage(message: {
  role: string;
  status: string;
}): message is PublicShareMessageRow {
  return (
    message.status !== "streaming" &&
    (message.role === "assistant" || message.role === "toolResult" || message.role === "user")
  );
}

function toDisplayChatMessages(messages: readonly PublicMessageRecord[]): DisplayChatMessage[] {
  return [...messages].sort(comparePublicMessages);
}

function truncateForkMarkdown(markdown: string): string {
  if (markdown.length <= MAX_FORK_MARKDOWN_CHARS) {
    return markdown;
  }

  const tailLength =
    MAX_FORK_MARKDOWN_CHARS - FORK_MARKDOWN_HEAD_CHARS - "\n\n...[truncated]...\n\n".length;
  const head = markdown.slice(0, FORK_MARKDOWN_HEAD_CHARS).trimEnd();
  const tail = markdown.slice(-tailLength).trimStart();
  return `${head}\n\n...[truncated]...\n\n${tail}`;
}

export function createPublicShareSnapshot(input: {
  messages: readonly MessageRow[];
  publishedAt: string;
  session: Pick<
    SessionData,
    "createdAt" | "id" | "repoSource" | "sourceUrl" | "title" | "updatedAt"
  >;
  updatedAt?: string;
}): {
  messages: PublicMessageRecord[];
  session: PublicSessionRecord;
} {
  const publicMessages: PublicMessageRecord[] = input.messages
    .filter(isPublicShareMessage)
    .sort(comparePublicMessages)
    .map(
      (message): PublicMessageRecord => ({
        ...message,
      }),
    );

  const title = input.session.title.trim() || "Shared chat";

  return {
    messages: publicMessages,
    session: {
      createdAt: input.session.createdAt,
      id: input.session.id,
      publishedAt: input.publishedAt,
      repoSource: input.session.repoSource,
      sourceUrl: input.session.sourceUrl,
      title,
      updatedAt: input.updatedAt ?? input.publishedAt,
    },
  };
}

export function buildForkPromptFromSharedSession(input: {
  messages: readonly PublicMessageRecord[];
  prompt: string;
  repoSource?: SessionData["repoSource"];
  sourceUrl?: string;
}): string {
  const markdown = truncateForkMarkdown(
    messagesToMarkdown(toDisplayChatMessages(input.messages), {
      repoSource: input.repoSource,
      sourceUrl: input.sourceUrl,
    }),
  );

  return [
    "Shared transcript:",
    "",
    markdown,
    "",
    "Start a new private conversation from that context.",
    "",
    `New prompt: ${input.prompt}`,
  ].join("\n");
}
