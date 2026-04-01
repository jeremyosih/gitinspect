import { defineHandler } from "nitro"

const COLLECTOR_URL = "https://collector.onedollarstats.com/events"

function setCorsHeaders(headers: Headers) {
  headers.set("access-control-allow-origin", "*")
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS")
  headers.set("access-control-allow-headers", "content-type")
  headers.set("cache-control", "no-cache")
}

export default defineHandler(async (event) => {
  if (event.req.method === "OPTIONS") {
    setCorsHeaders(event.res.headers)
    event.res.status = 204
    return ""
  }

  const forwardHeaders = new Headers()

  const forwardedFor =
    event.req.headers.get("x-vercel-forwarded-for") ??
    event.req.headers.get("x-real-ip")

  if (forwardedFor) {
    forwardHeaders.set("x-forwarded-for", forwardedFor)
  }

  const clientCountry = event.req.headers.get("x-vercel-ip-country")
  if (clientCountry) {
    forwardHeaders.set("x-client-country", clientCountry)
  }

  const clientRegion = event.req.headers.get("x-vercel-ip-country-region")
  if (clientRegion) {
    forwardHeaders.set("x-client-region", clientRegion)
  }

  const clientCity = event.req.headers.get("x-vercel-ip-city")
  if (clientCity) {
    forwardHeaders.set("x-client-city", clientCity)
  }

  const userAgent = event.req.headers.get("user-agent")
  if (userAgent) {
    forwardHeaders.set("user-agent", userAgent)
  }

  const contentType = event.req.headers.get("content-type")
  if (contentType) {
    forwardHeaders.set("content-type", contentType)
  }

  const referer = event.req.headers.get("referer")
  if (referer) {
    forwardHeaders.set("referer", referer)
  }

  const origin = event.req.headers.get("origin")
  if (origin) {
    forwardHeaders.set("origin", origin)
  }

  const body =
    event.req.method === "GET" || event.req.method === "HEAD"
      ? undefined
      : await event.req.text()

  const response = await fetch(COLLECTOR_URL, {
    method: event.req.method,
    headers: forwardHeaders,
    body,
  })

  const responseHeaders = new Headers(response.headers)
  setCorsHeaders(responseHeaders)
  responseHeaders.set(
    "content-type",
    response.headers.get("content-type") ?? "application/json",
  )

  if (!response.body) {
    event.res.status = response.status
    setCorsHeaders(event.res.headers)
    event.res.headers.set(
      "content-type",
      response.headers.get("content-type") ?? "application/json",
    )
    return ""
  }

  return new Response(response.body, {
    headers: responseHeaders,
    status: response.status,
    statusText: response.statusText,
  })
})
