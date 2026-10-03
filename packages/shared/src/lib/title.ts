export function truncateText(text: string, length: number): string {
  const trimmed = text.trim();

  if (trimmed.length <= length) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, length - 3)).trimEnd()}...`;
}
