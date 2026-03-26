import { parseRepoPathname, type ParsedRepoPath } from "@/repo/url"

export function parseRepoQuery(raw: string): ParsedRepoPath | undefined {
  const trimmed = raw.trim()
  if (!trimmed) {
    return undefined
  }

  const slash = trimmed.split("/").filter(Boolean)
  if (
    slash.length === 2 &&
    !trimmed.includes(" ") &&
    !trimmed.startsWith("http")
  ) {
    return parseRepoPathname(`/${slash[0]}/${slash[1]}`)
  }

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`
    const url = new URL(withProtocol)
    if (!url.hostname.endsWith("github.com")) {
      return undefined
    }

    return parseRepoPathname(url.pathname)
  } catch {
    return undefined
  }
}
