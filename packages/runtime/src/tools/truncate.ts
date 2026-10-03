const utf8Encoder = new TextEncoder();

export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024;

export interface TruncationResult {
  content: string;
  firstLineExceedsLimit: boolean;
  lastLinePartial: boolean;
  maxBytes: number;
  maxLines: number;
  outputBytes: number;
  outputLines: number;
  totalBytes: number;
  totalLines: number;
  truncated: boolean;
  truncatedBy: "bytes" | "lines" | null;
}

export interface TruncationOptions {
  maxBytes?: number;
  maxLines?: number;
}

function getByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

function truncateStringToBytesFromEnd(value: string, maxBytes: number): string {
  const bytes = utf8Encoder.encode(value);

  if (bytes.byteLength <= maxBytes) {
    return value;
  }

  const decoder = new TextDecoder();
  let start = bytes.byteLength - maxBytes;

  while (start < bytes.byteLength) {
    try {
      return decoder.decode(bytes.slice(start));
    } catch {
      start += 1;
    }
  }

  return "";
}

export function truncateHead(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lines = content.split("\n");
  const totalLines = lines.length;
  const totalBytes = getByteLength(content);

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      firstLineExceedsLimit: false,
      lastLinePartial: false,
      maxBytes,
      maxLines,
      outputBytes: totalBytes,
      outputLines: totalLines,
      totalBytes,
      totalLines,
      truncated: false,
      truncatedBy: null,
    };
  }

  const firstLine = lines[0] ?? "";

  if (getByteLength(firstLine) > maxBytes) {
    return {
      content: "",
      firstLineExceedsLimit: true,
      lastLinePartial: false,
      maxBytes,
      maxLines,
      outputBytes: 0,
      outputLines: 0,
      totalBytes,
      totalLines,
      truncated: true,
      truncatedBy: "bytes",
    };
  }

  const outputLines: string[] = [];
  let outputBytes = 0;
  let truncatedBy: "bytes" | "lines" = "lines";

  for (let index = 0; index < lines.length && index < maxLines; index += 1) {
    const line = lines[index] ?? "";
    const lineBytes = getByteLength(line) + (index > 0 ? 1 : 0);

    if (outputBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }

    outputLines.push(line);
    outputBytes += lineBytes;
  }

  if (outputLines.length >= maxLines && outputBytes <= maxBytes) {
    truncatedBy = "lines";
  }

  const outputContent = outputLines.join("\n");

  return {
    content: outputContent,
    firstLineExceedsLimit: false,
    lastLinePartial: false,
    maxBytes,
    maxLines,
    outputBytes: getByteLength(outputContent),
    outputLines: outputLines.length,
    totalBytes,
    totalLines,
    truncated: true,
    truncatedBy,
  };
}

export function truncateTail(content: string, options: TruncationOptions = {}): TruncationResult {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lines = content.split("\n");
  const totalLines = lines.length;
  const totalBytes = getByteLength(content);

  if (totalLines <= maxLines && totalBytes <= maxBytes) {
    return {
      content,
      firstLineExceedsLimit: false,
      lastLinePartial: false,
      maxBytes,
      maxLines,
      outputBytes: totalBytes,
      outputLines: totalLines,
      totalBytes,
      totalLines,
      truncated: false,
      truncatedBy: null,
    };
  }

  const outputLines: string[] = [];
  let outputBytes = 0;
  let truncatedBy: "bytes" | "lines" = "lines";
  let lastLinePartial = false;

  for (let index = lines.length - 1; index >= 0 && outputLines.length < maxLines; index -= 1) {
    const line = lines[index] ?? "";
    const lineBytes = getByteLength(line) + (outputLines.length > 0 ? 1 : 0);

    if (outputBytes + lineBytes > maxBytes) {
      truncatedBy = "bytes";

      if (outputLines.length === 0) {
        outputLines.unshift(truncateStringToBytesFromEnd(line, maxBytes));
        outputBytes = getByteLength(outputLines[0] ?? "");
        lastLinePartial = true;
      }

      break;
    }

    outputLines.unshift(line);
    outputBytes += lineBytes;
  }

  if (outputLines.length >= maxLines && outputBytes <= maxBytes) {
    truncatedBy = "lines";
  }

  const outputContent = outputLines.join("\n");

  return {
    content: outputContent,
    firstLineExceedsLimit: false,
    lastLinePartial,
    maxBytes,
    maxLines,
    outputBytes: getByteLength(outputContent),
    outputLines: outputLines.length,
    totalBytes,
    totalLines,
    truncated: true,
    truncatedBy,
  };
}
