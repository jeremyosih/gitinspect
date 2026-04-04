import type { GitHubAuthState, GitHubNoticeCtaIntent } from "@gitinspect/pi/repo/github-access";

export type GitHubAuthUiBridge = {
  getState: () => GitHubAuthState;
  runNoticeIntent: (intent: GitHubNoticeCtaIntent) => Promise<void>;
};

let bridge: GitHubAuthUiBridge | undefined;

export function registerGitHubAuthUiBridge(nextBridge: GitHubAuthUiBridge | undefined): void {
  bridge = nextBridge;
}

export function getGitHubAuthUiBridge(): GitHubAuthUiBridge | undefined {
  return bridge;
}
