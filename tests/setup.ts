import "fake-indexeddb/auto";
import { afterAll, vi } from "vitest";
import { db } from "@gitinspect/db";

vi.mock("autumn-js/react", () => ({
  AutumnProvider: ({ children }: { children: unknown }) => children,
  useCustomer: () => ({
    check: () => ({ allowed: true }),
    data: {},
    error: null,
    isLoading: false,
    refetch: vi.fn(async () => undefined),
  }),
}));

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    addEventListener: () => {},
    addListener: () => {},
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => {},
    removeListener: () => {},
  }),
});

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  configurable: true,
  value: MockResizeObserver,
});

afterAll(() => {
  db.close();
});
