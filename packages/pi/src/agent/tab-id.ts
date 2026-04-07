import { createId } from "@gitinspect/pi/lib/ids";

const TAB_ID_STORAGE_KEY = "gitinspect-tab-id";

let cachedTabId: string | undefined;

export function getCurrentTabIdIfAvailable(): string | undefined {
  if (cachedTabId) {
    return cachedTabId;
  }

  if (typeof window === "undefined") {
    return undefined;
  }

  const existing = window.sessionStorage.getItem(TAB_ID_STORAGE_KEY);

  if (existing) {
    cachedTabId = existing;
    return existing;
  }

  const next = createId();
  window.sessionStorage.setItem(TAB_ID_STORAGE_KEY, next);
  cachedTabId = next;
  return next;
}

export function getCurrentTabId(): string {
  const tabId = getCurrentTabIdIfAvailable();

  if (!tabId) {
    throw new Error("Tab identity requires a browser environment");
  }

  return tabId;
}
