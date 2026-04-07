import type { Remote } from "comlink";

function isRuntimeWorkerUnavailableError(error: Error): boolean {
  return (
    error instanceof ReferenceError ||
    error.message.includes("ComlinkWorker") ||
    error.message.includes("Worker is not defined")
  );
}

export function createRuntimeWorkerClient<TModule>(createWorker: () => Remote<TModule>): {
  getRuntimeWorker: () => Remote<TModule>;
  getRuntimeWorkerIfAvailable: () => Remote<TModule> | undefined;
} {
  let workerApi: Remote<TModule> | undefined;

  function getRuntimeWorker(): Remote<TModule> {
    if (workerApi) {
      return workerApi;
    }

    try {
      workerApi = createWorker();
      return workerApi;
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error(String(error));

      if (isRuntimeWorkerUnavailableError(nextError)) {
        throw new Error("Runtime worker is unavailable in this environment.");
      }

      throw nextError;
    }
  }

  function getRuntimeWorkerIfAvailable(): Remote<TModule> | undefined {
    try {
      return getRuntimeWorker();
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Runtime worker is unavailable in this environment."
      ) {
        return undefined;
      }

      throw error;
    }
  }

  return {
    getRuntimeWorker,
    getRuntimeWorkerIfAvailable,
  };
}
