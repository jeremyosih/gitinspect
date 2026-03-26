import { screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { RootGuard } from "@/components/root-guard"
import { renderWithProviders } from "@/test/render-with-providers"

describe("RootGuard", () => {
  it("renders children on any viewport", () => {
    renderWithProviders(
      <RootGuard>
        <div>App content</div>
      </RootGuard>
    )

    expect(screen.getByText("App content")).toBeTruthy()
  })
})
