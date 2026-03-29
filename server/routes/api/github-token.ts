import { defineHandler } from "nitro"

const TOKEN_URL = "https://github.com/login/oauth/access_token"
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? ""

export default defineHandler(async (event) => {
  if (event.req.method === "OPTIONS") {
    event.res.headers.set("access-control-allow-origin", "*")
    event.res.headers.set("access-control-allow-methods", "POST, OPTIONS")
    event.res.headers.set("access-control-allow-headers", "content-type")
    return ""
  }

  if (event.req.method !== "POST") {
    event.res.status = 405
    return { error: "Method not allowed" }
  }

  if (!CLIENT_SECRET) {
    event.res.status = 503
    return { error: "GitHub client secret is not configured" }
  }

  const body = JSON.parse(await event.req.text()) as Record<string, string>
  body.client_secret = CLIENT_SECRET

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  const data = await response.text()

  event.res.headers.set("content-type", "application/json")
  event.res.headers.set("access-control-allow-origin", "*")
  event.res.status = response.status

  return data
})
