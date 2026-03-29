import { createId } from "@/lib/ids"

const TAB_ID_STORAGE_KEY = "gitinspect-tab-id"

let cachedTabId: string | undefined

export function getCurrentTabId(): string {
  if (cachedTabId) {
    return cachedTabId
  }

  if (typeof window === "undefined") {
    throw new Error("Tab identity requires a browser environment")
  }

  const existing = window.sessionStorage.getItem(TAB_ID_STORAGE_KEY)

  if (existing) {
    cachedTabId = existing
    return existing
  }

  const next = createId()
  window.sessionStorage.setItem(TAB_ID_STORAGE_KEY, next)
  cachedTabId = next
  return next
}
