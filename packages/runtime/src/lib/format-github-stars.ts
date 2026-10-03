/** Compact display for GitHub stargazer counts (e.g. 179.7k). */
export function formatGitHubStarCount(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    const s = v >= 10 ? v.toFixed(0) : v.toFixed(1);
    return `${s.replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    const s = v >= 10 ? v.toFixed(0) : v.toFixed(1);
    return `${s.replace(/\.0$/, "")}k`;
  }
  return String(n);
}
