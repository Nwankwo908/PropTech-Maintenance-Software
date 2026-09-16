/** Partner widgets require utm_source to start with `cma-`. Provisioned source: cma-ulohome. */
export const THUMBTACK_DEFAULT_UTM_SOURCE = "cma-ulohome"

const ULO_UTM_ALIASES = new Set(["", "ulo", "ulohome", "cma-ulo", "cma-ulohome"])

export function normalizeThumbtackUtmSource(raw: string | null | undefined): string {
  const v = (raw ?? "").trim()
  if (ULO_UTM_ALIASES.has(v.toLowerCase())) return THUMBTACK_DEFAULT_UTM_SOURCE
  if (v.toLowerCase().startsWith("cma-")) return v
  return `cma-${v}`
}

function isSafeHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

/** Rewrite partner widget / embed URLs onto the provisioned utm_source. */
export function applyThumbtackPartnerUtm(
  url: string,
  fallbackUtm?: string | null,
): string {
  try {
    const parsed = new URL(url)
    const existing = parsed.searchParams.get("utm_source")
    parsed.searchParams.set(
      "utm_source",
      normalizeThumbtackUtmSource(existing || fallbackUtm),
    )
    return parsed.toString()
  } catch {
    return url
  }
}

export function resolveThumbtackRequestFlowUrl(input: {
  requestFlowUrl?: string | null
  listingUrl?: string | null
  searchId?: string | null
  categoryId?: string | null
  utmSource?: string | null
}): string | null {
  const widget = input.requestFlowUrl?.trim() ?? ""
  if (widget && isSafeHttpUrl(widget)) {
    return applyThumbtackPartnerUtm(widget, input.utmSource)
  }

  const categoryId = input.categoryId?.trim() ?? ""
  const searchId = input.searchId?.trim() ?? ""
  if (categoryId && searchId) {
    const utm = encodeURIComponent(normalizeThumbtackUtmSource(input.utmSource))
    return `https://www.thumbtack.com/embed/request-flow?category_pk=${encodeURIComponent(categoryId)}&project_pk=${encodeURIComponent(searchId)}&utm_source=${utm}`
  }

  const listing = input.listingUrl?.trim() ?? ""
  if (listing && isSafeHttpUrl(listing)) return listing
  return null
}
