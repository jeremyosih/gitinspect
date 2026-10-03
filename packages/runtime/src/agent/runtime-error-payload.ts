import { GitHubFsError } from "@gitinspect/vfs/types";

export type RuntimeErrorPayload =
  | {
      message: string;
      name: string;
      type: "error";
    }
  | {
      code: string;
      githubMessage?: string;
      isRetryable?: boolean;
      kind: GitHubFsError["kind"];
      message: string;
      path?: string;
      rateLimitKind?: GitHubFsError["rateLimitKind"];
      retryAt?: number;
      status?: number;
      type: "github";
    };

export function serializeRuntimeError(error: unknown): RuntimeErrorPayload {
  if (error instanceof GitHubFsError) {
    return {
      code: error.code,
      githubMessage: error.githubMessage,
      isRetryable: error.isRetryable,
      kind: error.kind,
      message: error.message,
      path: error.path,
      rateLimitKind: error.rateLimitKind,
      retryAt: error.retryAt,
      status: error.status,
      type: "github",
    };
  }

  const normalized = error instanceof Error ? error : new Error(String(error));

  return {
    message: normalized.message,
    name: normalized.name,
    type: "error",
  };
}

export function deserializeRuntimeError(payload: RuntimeErrorPayload): Error {
  if (payload.type === "github") {
    return new GitHubFsError({
      code: payload.code,
      githubMessage: payload.githubMessage,
      isRetryable: payload.isRetryable,
      kind: payload.kind,
      message: payload.message,
      path: payload.path,
      rateLimitKind: payload.rateLimitKind,
      retryAt: payload.retryAt,
      status: payload.status,
    });
  }

  const error = new Error(payload.message);
  error.name = payload.name;
  return error;
}
