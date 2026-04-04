import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AuthGate } from "@/components/root-guard"
import { renderWithProviders } from "@/test/render-with-providers"

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: vi.fn(() => {
    // Return a setting row with a token value to simulate authenticated state
    return [{ key: "github.credentials", value: '{"accessToken":"ghu_test","expiresAt":9999999999999,"refreshToken":"ghr_test","refreshTokenExpiresAt":9999999999999,"login":"test"}' }]
  }),
}))

describe("AuthGate", () => {
  it("renders children when authenticated", async () => {
    renderWithProviders(
      <AuthGate>
        <div>App content</div>
      </AuthGate>
    )

    await waitFor(() => {
      expect(screen.getByText("App content")).toBeTruthy()
    })
  })
})
