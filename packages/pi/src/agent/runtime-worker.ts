import { MissingSessionRuntimeError } from "@gitinspect/pi/agent/runtime-command-errors";
import { SessionWorkerCoordinator } from "@gitinspect/pi/agent/session-worker-coordinator";
import type {
  AppendSessionNoticeInput,
  ConfigureSessionInput,
  ReconcileInterruptedSessionInput,
  SetThinkingLevelInput,
  StartTurnInput,
  TurnCompletionResult,
} from "@gitinspect/pi/agent/runtime-worker-types";
import type { SessionData } from "@gitinspect/db";

const coordinators = new Map<string, SessionWorkerCoordinator>();
const coordinatorLoads = new Map<string, Promise<SessionWorkerCoordinator | undefined>>();

async function loadCoordinator(params: {
  sessionId: string;
  fallbackSession?: SessionData;
}): Promise<SessionWorkerCoordinator | undefined> {
  const coordinator = await SessionWorkerCoordinator.load({
    fallbackSession: params.fallbackSession,
    sessionId: params.sessionId,
  });

  if (coordinator) {
    coordinators.set(params.sessionId, coordinator);
  }

  return coordinator;
}

async function getOrCreateCoordinator(
  sessionId: string,
  options?: { fallbackSession?: SessionData },
): Promise<SessionWorkerCoordinator | undefined> {
  const existing = coordinators.get(sessionId);

  if (existing) {
    return existing;
  }

  const pending = coordinatorLoads.get(sessionId);

  if (pending) {
    const loaded = await pending;

    if (loaded || !options?.fallbackSession) {
      return loaded;
    }
  }

  const loadPromise = loadCoordinator({
    fallbackSession: options?.fallbackSession,
    sessionId,
  }).finally(() => {
    coordinatorLoads.delete(sessionId);
  });

  coordinatorLoads.set(sessionId, loadPromise);
  return await loadPromise;
}

async function getLoadedCoordinator(
  sessionId: string,
): Promise<SessionWorkerCoordinator | undefined> {
  const existing = coordinators.get(sessionId);

  if (existing) {
    return existing;
  }

  const pending = coordinatorLoads.get(sessionId);
  return pending ? await pending : undefined;
}

async function disposeIdleCoordinator(
  sessionId: string,
  coordinator: SessionWorkerCoordinator | undefined,
): Promise<void> {
  if (!coordinator || coordinators.get(sessionId) !== coordinator || !coordinator.isIdle()) {
    return;
  }

  await coordinator.dispose();

  if (coordinators.get(sessionId) === coordinator) {
    coordinators.delete(sessionId);
  }
}

export async function startTurn(input: StartTurnInput): Promise<void> {
  const coordinator = await getOrCreateCoordinator(input.session.id, {
    fallbackSession: input.session,
  });

  if (!coordinator) {
    throw new MissingSessionRuntimeError(input.session.id);
  }

  await coordinator.startTurn(input);
}

export async function waitForTurn(sessionId: string): Promise<TurnCompletionResult | undefined> {
  return await (await getLoadedCoordinator(sessionId))?.waitForTurn();
}

export async function abortTurn(sessionId: string): Promise<void> {
  await (await getLoadedCoordinator(sessionId))?.abortTurn();
}

export async function disposeSession(sessionId: string): Promise<void> {
  const coordinator = await getLoadedCoordinator(sessionId);

  if (!coordinator) {
    return;
  }

  await coordinator.dispose();
  coordinators.delete(sessionId);
}

export async function setModelSelection(input: ConfigureSessionInput): Promise<void> {
  const coordinator = await getOrCreateCoordinator(input.sessionId);

  if (!coordinator) {
    return;
  }

  await coordinator.setModelSelection(input);
  await disposeIdleCoordinator(input.sessionId, coordinator);
}

export async function setThinkingLevel(input: SetThinkingLevelInput): Promise<void> {
  const coordinator = await getOrCreateCoordinator(input.sessionId);

  if (!coordinator) {
    return;
  }

  await coordinator.setThinkingLevel(input);
  await disposeIdleCoordinator(input.sessionId, coordinator);
}

export async function appendSessionNotice(input: AppendSessionNoticeInput): Promise<void> {
  const coordinator = await getOrCreateCoordinator(input.sessionId);

  if (!coordinator) {
    return;
  }

  await coordinator.appendSessionNotice(new Error(input.error));
  await disposeIdleCoordinator(input.sessionId, coordinator);
}

export async function reconcileInterruptedSession(
  input: ReconcileInterruptedSessionInput,
): Promise<void> {
  const coordinator = await getOrCreateCoordinator(input.sessionId);

  if (!coordinator) {
    return;
  }

  await coordinator.reconcileInterruptedSession(input);
  await disposeIdleCoordinator(input.sessionId, coordinator);
}
