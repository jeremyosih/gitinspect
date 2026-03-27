import * as React from "react"
import { ArrowUpRight } from "lucide-react"
import {
  GITHUB_CREATE_PAT_URL,
  getGithubPersonalAccessToken,
  setGithubPersonalAccessToken,
  validateGithubPersonalAccessToken,
} from "@/repo/github-token"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export function GithubTokenSettings(props: {
  disabled?: boolean
  onTokenSaved?: () => void | Promise<void>
}) {
  const [token, setToken] = React.useState("")
  const [hasSavedToken, setHasSavedToken] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    let disposed = false

    void (async () => {
      const stored = await getGithubPersonalAccessToken()

      if (disposed) {
        return
      }

      const present = Boolean(stored?.trim())
      setToken(stored ?? "")
      setHasSavedToken(present)
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
          Unauthenticated requests are limited to 60/hour. Adding a token bumps
          the limit to 5,000/hour.
        </p>

        <p className="mt-2 text-xs text-muted-foreground">
          Fine-grained token, read-only repository access. We verify it with
          GitHub before saving. Repo scope follows URLs like{" "}
          <span className="font-mono text-[11px]">/owner/repo</span>.
        </p>

        {!isLoading && !hasSavedToken ? (
          <Button
            className="mt-4 h-8 w-full gap-1 text-xs sm:w-auto"
            disabled={props.disabled || isSaving}
            onClick={() => {
              window.open(
                GITHUB_CREATE_PAT_URL,
                "_blank",
                "noopener,noreferrer"
              )
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Generate GitHub Token
            <ArrowUpRight className="size-3.5 opacity-70" />
          </Button>
        ) : null}

        <div
          className={cn(
            "space-y-2",
            !isLoading && !hasSavedToken ? "mt-3" : "mt-4"
          )}
        >
          <Label htmlFor="github-pat">Access token</Label>
          <Input
            autoComplete="off"
            disabled={props.disabled || isLoading || isSaving}
            id="github-pat"
            onChange={(event) => setToken(event.target.value)}
            placeholder="github_pat_…"
            type="password"
            value={token}
          />
          <p className="text-xs text-muted-foreground">
            Stored only in this browser.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            disabled={props.disabled || isLoading || isSaving}
            onClick={async () => {
              const next = token.trim()
              setIsSaving(true)
              try {
                if (!next) {
                  setToken("")
                  await setGithubPersonalAccessToken(undefined)
                  setHasSavedToken(false)
                  toast.success("GitHub token cleared")
                  await props.onTokenSaved?.()
                  return
                }

                const result = await validateGithubPersonalAccessToken(next)
                if (!result.ok) {
                  toast.error(result.message)
                  return
                }

                await setGithubPersonalAccessToken(next)
                setHasSavedToken(true)
                toast.success(`GitHub connected as @${result.login}`)
                await props.onTokenSaved?.()
              } catch {
                toast.error("Could not save GitHub token")
              } finally {
                setIsSaving(false)
              }
            }}
            size="sm"
          >
            Save token
          </Button>
          {!isLoading && hasSavedToken ? (
            <Button
              disabled={props.disabled || isSaving}
              onClick={async () => {
                setIsSaving(true)
                try {
                  setToken("")
                  await setGithubPersonalAccessToken(undefined)
                  setHasSavedToken(false)
                  toast.success("GitHub token deleted")
                  await props.onTokenSaved?.()
                } catch {
                  toast.error("Could not delete GitHub token")
                } finally {
                  setIsSaving(false)
                }
              }}
              size="sm"
              variant="ghost"
            >
              Delete Token
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
