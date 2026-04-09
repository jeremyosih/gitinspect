import type { TurnEnvelope } from "@gitinspect/pi/agent/turn-event-store";
import type { ProviderGroupId, ThinkingLevel } from "@gitinspect/pi/types/models";
import type { SessionData } from "@gitinspect/db";

export type TurnCompletionStatus = "aborted" | "completed" | "error" | "interrupted";

export type TurnCompletionResult = {
  lastError?: string;
  sessionId: string;
  status: TurnCompletionStatus;
};

export type StartTurnInput = {
  ownerTabId: string;
  session: SessionData;
  turn: TurnEnvelope;
};

export type ConfigureSessionInput = {
  modelId: string;
  providerGroup: ProviderGroupId;
  sessionId: string;
};

export type SetThinkingLevelInput = {
  sessionId: string;
  thinkingLevel: ThinkingLevel;
};

export type AppendSessionNoticeInput = {
  error: string;
  sessionId: string;
};

export type ReconcileInterruptedSessionInput = {
  sessionId: string;
};
