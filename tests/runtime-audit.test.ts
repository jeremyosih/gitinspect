import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createRuntime } from "@/agent/runtime"

function readFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8")
}

describe("runtime audit", () => {
  it("keeps the tool seam explicit and empty by default", () => {
    expect(createRuntime()).toEqual({
      tools: [],
    })
  })

  it("contains no extension-only runtime code in app sources", () => {
    const files = [
      "src/agent/runtime.ts",
      "src/agent/provider-stream.ts",
      "src/agent/runtime-client.ts",
      "src/agent/runtime-worker.ts",
      "src/hooks/use-runtime-session.ts",
      "src/components/app-shell-page.tsx",
      "src/sessions/session-actions.ts",
      "src/auth/popup-flow.ts",
    ]
    const content = files.map(readFile).join("\n")

    expect(content).not.toContain("chrome.")
    expect(content).not.toContain("browserjs")
    expect(content).not.toContain("NavigationMessage")
    expect(content).not.toMatch(/\bRepl\b/)
  })
})
