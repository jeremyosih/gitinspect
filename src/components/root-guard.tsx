import * as React from "react"
import { useLiveQuery } from "dexie-react-hooks"
import { toast } from "sonner"
import { db } from "@/db/schema"
import { loginWithGitHub } from "@/repo/github-token"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function AuthGate(props: { children: React.ReactNode }) {
  const rows = useLiveQuery(() =>
    db.settings.where("key").equals("github.credentials").toArray()
  )

  if (rows === undefined) {
    return null
  }

  const token = rows[0]?.value
  const hasToken = Boolean(
    token && typeof token === "string" && token.trim()
  )

  if (!hasToken) {
    return <LoginPrompt />
  }

  return <>{props.children}</>
}

function LoginPrompt() {
  const [isLoggingIn, setIsLoggingIn] = React.useState(false)

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>Sign in required</CardTitle>
          <CardDescription>
            Sign in with GitHub to explore repositories.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-1 text-left text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-xs">&#x2713;</span>
              Read-only access to public repos
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-xs">&#x2713;</span>
              Higher API rate limits (5,000 req/hr)
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-xs">&#x2713;</span>
              No write permissions, ever
            </li>
          </ul>
          <Button
            disabled={isLoggingIn}
            onClick={async () => {
              setIsLoggingIn(true)
              try {
                await loginWithGitHub()
              } catch {
                toast.error("Sign-in did not complete")
              } finally {
                setIsLoggingIn(false)
              }
            }}
          >
            {isLoggingIn ? "Signing in\u2026" : "Sign in with GitHub"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
