export function shouldUseProxyForProvider(provider: string, apiKey: string): boolean {
  return (
    ["openai", "openai-codex", "opencode", "opencode-go"].includes(provider) ||
    (provider === "anthropic" && (apiKey.startsWith("sk-ant-oat") || apiKey.startsWith("{")))
  );
}
