import { refreshAnthropic } from "@gitinspect/runtime/auth/providers/anthropic";
import { refreshGitHubCopilot } from "@gitinspect/runtime/auth/providers/github-copilot";
import { refreshGeminiCli } from "@gitinspect/runtime/auth/providers/google-gemini-cli";
import { refreshOpenAICodex } from "@gitinspect/runtime/auth/providers/openai-codex";
import type { OAuthCredentials } from "@gitinspect/runtime/auth/oauth-types";
import type { ProxyRequestOptions } from "@gitinspect/runtime/auth/oauth-utils";

export async function oauthRefresh(
  credentials: OAuthCredentials,
  options?: ProxyRequestOptions,
): Promise<OAuthCredentials> {
  switch (credentials.providerId) {
    case "anthropic":
      return await refreshAnthropic(credentials, options);
    case "github-copilot":
      return await refreshGitHubCopilot(credentials);
    case "google-gemini-cli":
      return await refreshGeminiCli(credentials);
    case "openai-codex":
      return await refreshOpenAICodex(credentials);
  }
}
