import { configure } from "onedollarstats"
import { useEffect } from "react"

export function Analytics() {
  useEffect(() => {
    configure({
      autocollect: true,
      collectorUrl: "/api/e",
      devmode: process.env.VERCEL_ENV !== "production",
      excludePages: ["/chat", "/chat/*"],
      hostname: "gitinspect.com",
    })
  }, [])

  return null
}
