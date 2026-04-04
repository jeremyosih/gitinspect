import { z } from "zod";

export const feedbackSentimentSchema = z.enum(["happy", "neutral", "sad"]);
export const feedbackThemeSchema = z.enum(["light", "dark", "system"]);

export const feedbackRepoSchema = z.object({
  owner: z.string().trim().min(1).max(100),
  repo: z.string().trim().min(1).max(100),
  ref: z.string().trim().min(1).max(200).optional(),
  path: z.string().trim().min(1).max(500).optional(),
});

export const feedbackDiagnosticsSchema = z.object({
  pathname: z.string().trim().min(1).max(300).optional(),
  repo: feedbackRepoSchema.optional(),
  provider: z.string().trim().min(1).max(100).optional(),
  model: z.string().trim().min(1).max(150).optional(),
  viewport: z
    .object({
      width: z.number().int().min(0).max(10_000),
      height: z.number().int().min(0).max(10_000),
      dpr: z.number().min(0.5).max(10).optional(),
    })
    .optional(),
  theme: feedbackThemeSchema.optional(),
  language: z.string().trim().min(1).max(50).optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
});

export const feedbackSchema = z.object({
  sentiment: feedbackSentimentSchema,
  message: z.string().trim().min(4).max(2_000),
  includeDiagnostics: z.boolean(),
  diagnostics: feedbackDiagnosticsSchema.optional(),
  website: z.string().trim().max(200).optional(),
});

export type FeedbackPayload = z.infer<typeof feedbackSchema>;
export type FeedbackDiagnostics = z.infer<typeof feedbackDiagnosticsSchema>;
export type FeedbackSentiment = z.infer<typeof feedbackSentimentSchema>;

export function normalizeFeedbackPayload(payload: FeedbackPayload): FeedbackPayload {
  if (!payload.includeDiagnostics) {
    return {
      ...payload,
      diagnostics: undefined,
    };
  }

  return payload;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function sanitizeInline(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = normalizeWhitespace(value);
  return normalized ? truncate(normalized, maxLength) : undefined;
}

function sanitizeMultiline(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxLength
    ? trimmed
    : `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function sentimentLabel(sentiment: FeedbackSentiment): string {
  if (sentiment === "happy") {
    return "positive";
  }

  if (sentiment === "sad") {
    return "negative";
  }

  return "neutral";
}

export function buildFeedbackIssueTitle(
  input: Pick<FeedbackPayload, "message" | "sentiment">,
): string {
  const summary = sanitizeInline(input.message, 72) ?? "Untitled feedback";
  return `Feedback: [${input.sentiment}] ${summary}`;
}

export function buildFeedbackLabels(payload: FeedbackPayload): string[] {
  const labels = ["feedback", "web", sentimentLabel(payload.sentiment)];

  if (payload.includeDiagnostics) {
    labels.push("has-diagnostics");
  }

  return labels;
}

export function buildFeedbackIssueBody(input: {
  payload: FeedbackPayload;
  referer: string | null;
  submittedAt: string;
  userAgent: string | null;
}): string {
  const { diagnostics, includeDiagnostics, message, sentiment } = input.payload;
  const lines = [
    "## Feedback",
    sanitizeMultiline(message, 2_000),
    "",
    "## Sentiment",
    sentiment,
    "",
    "## Diagnostics",
    `- included: ${includeDiagnostics ? "yes" : "no"}`,
  ];

  if (includeDiagnostics) {
    const pathname = sanitizeInline(diagnostics?.pathname, 300);
    const repoOwner = sanitizeInline(diagnostics?.repo?.owner, 100);
    const repoName = sanitizeInline(diagnostics?.repo?.repo, 100);
    const repoRef = sanitizeInline(diagnostics?.repo?.ref, 200);
    const repoPath = sanitizeInline(diagnostics?.repo?.path, 500);
    const provider = sanitizeInline(diagnostics?.provider, 100);
    const model = sanitizeInline(diagnostics?.model, 150);
    const theme = diagnostics?.theme;
    const language = sanitizeInline(diagnostics?.language, 50);
    const timezone = sanitizeInline(diagnostics?.timezone, 100);
    const userAgent = sanitizeInline(input.userAgent ?? undefined, 500);
    const referer = sanitizeInline(input.referer ?? undefined, 500);

    if (pathname) {
      lines.push(`- pathname: ${pathname}`);
    }

    if (repoOwner && repoName) {
      lines.push(`- repo: ${repoOwner}/${repoName}`);
    }

    if (repoRef) {
      lines.push(`- ref: ${repoRef}`);
    }

    if (repoPath) {
      lines.push(`- path: ${repoPath}`);
    }

    if (provider) {
      lines.push(`- provider: ${provider}`);
    }

    if (model) {
      lines.push(`- model: ${model}`);
    }

    if (diagnostics?.viewport) {
      const dpr = diagnostics.viewport.dpr ? ` @ ${diagnostics.viewport.dpr}x` : "";
      lines.push(`- viewport: ${diagnostics.viewport.width}x${diagnostics.viewport.height}${dpr}`);
    }

    if (theme) {
      lines.push(`- theme: ${theme}`);
    }

    if (language) {
      lines.push(`- language: ${language}`);
    }

    if (timezone) {
      lines.push(`- timezone: ${timezone}`);
    }

    if (userAgent) {
      lines.push(`- user-agent: ${userAgent}`);
    }

    if (referer) {
      lines.push(`- referer: ${referer}`);
    }
  }

  lines.push(`- submitted-at: ${input.submittedAt}`);

  return `${lines.join("\n")}\n`;
}
