/** Partner widgets require utm_source to start with `cma-`. */
export function normalizeThumbtackUtmSource(raw: string | null | undefined): string {
  const v = (raw ?? "").trim() || "ulo"
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

/**
 * Thumbtack contact URL for a listed pro.
 * Prefer the search `widgets.requestFlowURL` (official Request Flow widget).
 * Fall back to the embed request-flow URL, then the service page.
 */
export function resolveThumbtackRequestFlowUrl(input: {
  requestFlowUrl?: string | null
  listingUrl?: string | null
  searchId?: string | null
  categoryId?: string | null
  utmSource?: string | null
}): string | null {
  const widget = input.requestFlowUrl?.trim() ?? ""
  if (widget && isSafeHttpUrl(widget)) return widget

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
