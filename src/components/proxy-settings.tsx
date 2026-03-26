import * as React from "react"
import { toast } from "sonner"
import { DEFAULT_PROXY_URL, getProxyConfig, setProxyConfig } from "@/proxy/settings"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export function ProxySettings(props: { disabled?: boolean }) {
  const [enabled, setEnabled] = React.useState(false)
  const [url, setUrl] = React.useState(DEFAULT_PROXY_URL)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)

  React.useEffect(() => {
    let disposed = false

    void (async () => {
      const config = await getProxyConfig()

      if (disposed) {
        return
      }

      setEnabled(config.enabled)
      setUrl(config.url)
      setIsLoading(false)
    })()

    return () => {
      disposed = true
    }
  }, [])

  return (
    <div className="space-y-4">
      <div className="rounded-none border border-foreground/10 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="proxy-enabled">Enable proxy</Label>
            <div className="text-xs text-muted-foreground">
              When enabled, OpenAI, OpenAI Codex, OpenCode, and OpenCode Go requests use the proxy; Anthropic subscription OAuth can use it for token calls. Gemini and Copilot stay direct. OpenCode Free always uses the built-in server proxy regardless of this setting.
            </div>
          </div>
          <Switch
            checked={enabled}
            disabled={props.disabled || isLoading || isSaving}
            id="proxy-enabled"
            onCheckedChange={setEnabled}
          />
        </div>

        <div className="mt-4 space-y-2">
          <Label htmlFor="proxy-url">Proxy base URL</Label>
          <Input
            disabled={props.disabled || isLoading || isSaving}
            id="proxy-url"
            onChange={(event) => setUrl(event.target.value)}
            placeholder={DEFAULT_PROXY_URL}
            value={url}
          />
          <div className="text-xs text-muted-foreground">
            Expected format: `&lt;proxy-url&gt;/?url=&lt;target-url&gt;`
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            disabled={props.disabled || isLoading || isSaving}
            onClick={async () => {
              setIsSaving(true)
              try {
                await setProxyConfig({
                  enabled,
                  url: url.trim(),
                })
                toast.success("Proxy settings saved")
              } catch {
                toast.error("Could not save proxy settings")
              } finally {
                setIsSaving(false)
              }
            }}
            size="sm"
          >
            Save proxy settings
          </Button>
          <div className="text-xs text-muted-foreground">
            Saves locally in Dexie.
          </div>
        </div>
      </div>
    </div>
  )
}
