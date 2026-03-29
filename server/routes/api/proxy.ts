import { defineHandler } from "nitro"

const ALLOWED_HOSTS = new Set(["api.fireworks.ai"])

export default defineHandler(async (event) => {
  const targetUrl = event.url.searchParams.get("url")

  if (!targetUrl) {
    event.res.status = 400
    return { error: "Missing ?url= parameter" }
  }

  let target: URL
  try {
    target = new URL(targetUrl)
  } catch {
    event.res.status = 400
    return { error: "Invalid target URL" }
  }

  if (!ALLOWED_HOSTS.has(target.host)) {
    event.res.status = 403
    return { error: `Host not allowed: ${target.host}` }
  }

  const apiKey = process.env.FIREWORKS_API_KEY
  if (!apiKey) {
    event.res.status = 503
    return { error: "Server proxy is not configured" }
  }

  if (event.req.method === "OPTIONS") {
    event.res.headers.set("access-control-allow-origin", "*")
    event.res.headers.set("access-control-allow-methods", "GET, POST, OPTIONS")
    event.res.headers.set("access-control-allow-headers", "content-type, authorization")
    return ""
  }

  const forwardHeaders = new Headers({
    authorization: `Bearer ${apiKey}`,
  })

  const contentType = event.req.headers.get("content-type")
  if (contentType) {
    forwardHeaders.set("content-type", contentType)
  }

  for (const [key, value] of event.req.headers.entries()) {
    if (key.startsWith("x-")) {
      forwardHeaders.set(key, value)
    }
  }

  let body: string | undefined
  if (event.req.method !== "GET" && event.req.method !== "HEAD") {
    body = await event.req.text()
  }

  let response: Response

  try {
    response = await fetch(target.toString(), {
      method: event.req.method,
      headers: forwardHeaders,
      body,
    })
  } catch {
    throw
  }

  event.res.headers.set(
    "content-type",
    response.headers.get("content-type") ?? "application/json",
  )
  event.res.headers.set("cache-control", "no-cache")
  event.res.headers.set("access-control-allow-origin", "*")

  if (!response.body) {
    event.res.status = response.status
    return ""
  }

  const headers = new Headers(response.headers)
  headers.set(
    "content-type",
    response.headers.get("content-type") ?? "application/json",
  )
  headers.set("cache-control", "no-cache")
  headers.set("access-control-allow-origin", "*")

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
})
