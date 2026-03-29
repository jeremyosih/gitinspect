import * as React from "react"
import {
  getGithubLogin,
  getGithubPersonalAccessToken,
  loginWithGitHub,
  logoutGitHub,
} from "@/repo/github-token"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export function GithubTokenSettings(props: {
  disabled?: boolean
  onTokenSaved?: () => void | Promise<void>
}) {
  const [login, setLogin] = React.useState<string | undefined>()
  const [isConnected, setIsConnected] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isBusy, setIsBusy] = React.useState(false)

  React.useEffect(() => {
    let disposed = false

    void (async () => {
      const [token, storedLogin] = await Promise.all([
        getGithubPersonalAccessToken(),
        getGithubLogin(),
      ])

      if (disposed) return

      const connected = Boolean(token?.trim())
      setIsConnected(connected)
      setLogin(storedLogin)
      setIsLoading(false)
    })()

    return () => {
      disposed = true
    }
  }, [])

  return (
    <div className="space-y-4">
      <div className="rounded-none border border-foreground/10 p-4">
        <p className="text-xs text-muted-foreground">
          Authenticated requests get 5,000/hour. Sign in with GitHub to
          continue.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isLoading ? null : isConnected ? (
            <>
              <p className="text-sm text-foreground">
                Connected{login ? ` as @${login}` : ""}
              </p>
              <Button
                disabled={props.disabled || isBusy}
                onClick={async () => {
                  setIsBusy(true)
                  try {
                    await logoutGitHub()
                    setIsConnected(false)
                    setLogin(undefined)
                    toast.success("GitHub disconnected")
                    await props.onTokenSaved?.()
                  } catch {
                    toast.error("Could not disconnect")
                  } finally {
                    setIsBusy(false)
                  }
                }}
                size="sm"
                variant="ghost"
              >
                Disconnect
              </Button>
            </>
          ) : (
            <Button
              disabled={props.disabled || isBusy}
              onClick={async () => {
                setIsBusy(true)
                try {
                  const name = await loginWithGitHub()
                  setIsConnected(true)
                  setLogin(name)
                  toast.success(`GitHub connected as @${name}`)
                  await props.onTokenSaved?.()
                } catch {
                  toast.error("Sign-in did not complete")
                } finally {
                  setIsBusy(false)
                }
              }}
              size="sm"
            >
              Sign in with GitHub
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
