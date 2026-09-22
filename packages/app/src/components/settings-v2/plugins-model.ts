export type PluginHit = {
  name: string
  version?: string
  description?: string
  publisher?: string
}

export const PLUGIN_SEARCH_KEYWORD = "opencode-plugin"
export const PLUGIN_SEARCH_SIZE = 50

export function pluginSearchUrl(query: string) {
  const url = new URL("https://registry.npmjs.org/-/v1/search")
  // The keyword qualifier lists the tagged catalog, but it ignores free terms, so a typed query
  // searches plain terms for relevance and relies on pluginHits to drop unrelated packages.
  const text = query.trim()
  url.searchParams.set("text", text ? `${text} ${PLUGIN_SEARCH_KEYWORD}` : `keywords:${PLUGIN_SEARCH_KEYWORD}`)
  url.searchParams.set("size", String(PLUGIN_SEARCH_SIZE))
  return url
}

export function pluginSpecifier(spec: string | [string, Record<string, unknown>]) {
  return typeof spec === "string" ? spec : spec[0]
}

export function packageName(spec: string) {
  const at = spec.lastIndexOf("@")
  return at > 0 ? spec.slice(0, at) : spec
}

export function isLocalPlugin(spec: string) {
  return spec.startsWith("file://") || spec.startsWith(".") || /^([A-Za-z]:)?[\\/]/.test(spec)
}

export function pluginHits(body: unknown): PluginHit[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.objects)) return undefined
  return body.objects.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.package)) return []
    const item = entry.package
    if (typeof item.name !== "string") return []
    const description = typeof item.description === "string" ? item.description : undefined
    const keywords = Array.isArray(item.keywords) ? item.keywords.filter((keyword) => typeof keyword === "string") : []
    if (!isPluginPackage(item.name, description, keywords)) return []
    return [
      {
        name: item.name,
        version: typeof item.version === "string" ? item.version : undefined,
        description,
        publisher:
          isRecord(item.publisher) && typeof item.publisher.username === "string"
            ? item.publisher.username
            : undefined,
      },
    ]
  })
}

function isPluginPackage(name: string, description: string | undefined, keywords: string[]) {
  const tags = keywords.map((keyword) => keyword.toLowerCase())
  if (tags.includes("opencode") || tags.includes(PLUGIN_SEARCH_KEYWORD)) return true
  if (name.toLowerCase().includes("opencode")) return true
  return description?.toLowerCase().includes("opencode") ?? false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
