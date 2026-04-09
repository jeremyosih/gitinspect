import type { ResolvedRepoSource } from "@gitinspect/db";
import { messagesToMarkdown } from "@gitinspect/pi/lib/copy-session-markdown";
import type { DisplayChatMessage } from "@gitinspect/pi/types/chat";

export const SHARED_TRANSCRIPT_CHAR_CAP = 80_000;

export function buildSharedFollowupPrompt(input: { exportedMarkdown: string; userPrompt: string }) {
  return [
    "You are continuing from a shared GitInspect conversation.",
    "Use the following conversation export as context:",
    "",
    input.exportedMarkdown,
    "",
    "Now answer this new follow-up question:",
    input.userPrompt,
  ].join("\n");
}

export function buildCappedSharedTranscriptMarkdown(input: {
  messages: readonly DisplayChatMessage[];
  repoSource?: ResolvedRepoSource;
  sourceUrl?: string;
  charCap?: number;
}): { markdown: string; truncated: boolean } {
  const charCap = input.charCap ?? SHARED_TRANSCRIPT_CHAR_CAP;
  const messages = [...input.messages];
  let markdown = messagesToMarkdown(messages, {
    repoSource: input.repoSource,
    sourceUrl: input.sourceUrl,
  });

  if (markdown.length <= charCap) {
    return { markdown, truncated: false };
  }

  const retained = [...messages];

  while (retained.length > 1) {
    retained.shift();
    markdown = messagesToMarkdown(retained, {
      repoSource: input.repoSource,
      sourceUrl: input.sourceUrl,
    });

    if (markdown.length <= charCap) {
      return {
        markdown: [
          "Note: this shared transcript was truncated to the most recent turns to fit the follow-up context window.",
          "",
          markdown,
        ].join("\n"),
        truncated: true,
      };
    }
  }

  return {
    markdown: markdown.slice(-charCap),
    truncated: true,
  };
}
