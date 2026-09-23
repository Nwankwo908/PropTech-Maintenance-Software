/** Partner widgets require utm_source to start with `cma-`. Provisioned source: cma-ulohome. */
export const THUMBTACK_DEFAULT_UTM_SOURCE = "cma-ulohome"

/** Stable iframe id for Service Page Widget (must match iframe_id query + script data-iframe-id). */
export const THUMBTACK_SERVICE_PAGE_IFRAME_ID = "ulo-thumbtack-service-page"

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
    if (!parsed.searchParams.get("utm_medium")) {
      parsed.searchParams.set("utm_medium", "partnership")
    }
    return parsed.toString()
  } catch {
    return url
  }
}

function isRequestFlowEmbedPath(pathname: string): boolean {
  return pathname.includes("/embed/request-flow")
}

/**
 * Thumbtack Request Flow iframe URL for a listed pro.
 * Prefer `widgets.requestFlowURL`, then build from category + service_pk
 * (official RF embed). Do not fall back to public listing pages — they refuse iframes.
 * @see https://developers.thumbtack.com/docs/marketplace/widgets/request-flow
 */
export function resolveThumbtackRequestFlowUrl(input: {
  requestFlowUrl?: string | null
  listingUrl?: string | null
  searchId?: string | null
  categoryId?: string | null
  servicePk?: string | null
  providerRef?: string | null
  zipCode?: string | null
  utmSource?: string | null
}): string | null {
  const utm = normalizeThumbtackUtmSource(input.utmSource)
  const zip = input.zipCode?.trim() ?? ""

  const widget = input.requestFlowUrl?.trim() ?? ""
  if (widget && isSafeHttpUrl(widget)) {
    try {
      const parsed = new URL(widget)
      if (isRequestFlowEmbedPath(parsed.pathname)) {
        parsed.searchParams.set("utm_source", utm)
        if (!parsed.searchParams.get("utm_medium")) {
          parsed.searchParams.set("utm_medium", "partnership")
        }
        if (zip && !parsed.searchParams.get("zip_code")) {
          parsed.searchParams.set("zip_code", zip)
        }
        if (parsed.hostname === "www.thumbtack.com") {
          parsed.hostname = "thumbtack.com"
        }
        return parsed.toString()
      }
    } catch {
      /* fall through */
    }
    // Non-embed widget URL — still usable if Thumbtack returned it.
    return applyThumbtackPartnerUtm(widget, input.utmSource)
  }

  const categoryId =
    input.categoryId?.trim() ||
    extractThumbtackCategoryPk({
      listingUrl: input.listingUrl,
      requestFlowUrl: input.requestFlowUrl,
      categoryId: input.categoryId,
    }) ||
    ""
  const servicePk =
    input.servicePk?.trim() ||
    extractThumbtackServicePk({
      listingUrl: input.listingUrl,
      providerRef: input.providerRef ?? input.servicePk,
    }) ||
    ""

  if (categoryId && servicePk) {
    const url = new URL("https://thumbtack.com/embed/request-flow")
    url.searchParams.set("category_pk", categoryId)
    url.searchParams.set("service_pk", servicePk)
    if (zip) url.searchParams.set("zip_code", zip)
    url.searchParams.set("utm_source", utm)
    url.searchParams.set("utm_medium", "partnership")
    return url.toString()
  }

  // Legacy search-project shape (older partner docs / some search payloads).
  const searchId = input.searchId?.trim() ?? ""
  if (categoryId && searchId) {
    const url = new URL("https://thumbtack.com/embed/request-flow")
    url.searchParams.set("category_pk", categoryId)
    url.searchParams.set("project_pk", searchId)
    if (zip) url.searchParams.set("zip_code", zip)
    url.searchParams.set("utm_source", utm)
    url.searchParams.set("utm_medium", "partnership")
    return url.toString()
  }

  return null
}

function isServicePageEmbedPath(pathname: string): boolean {
  return pathname.includes("/embed/service-page")
}

/** Pull service_pk from an embed query or a public `/service/{id}` path. */
export function extractThumbtackServicePk(input: {
  listingUrl?: string | null
  providerRef?: string | null
}): string | null {
  const fromRef = input.providerRef?.trim() ?? ""
  if (fromRef) return fromRef
  const raw = input.listingUrl?.trim() ?? ""
  if (!raw || !isSafeHttpUrl(raw)) return null
  try {
    const url = new URL(raw)
    const fromQuery =
      url.searchParams.get("service_pk")?.trim() ||
      url.searchParams.get("service_pk".toUpperCase())?.trim() ||
      ""
    if (fromQuery) return fromQuery
    const pathMatch = url.pathname.match(/\/service\/(\d+)/i)
    return pathMatch?.[1] ?? null
  } catch {
    return null
  }
}

export function extractThumbtackCategoryPk(input: {
  listingUrl?: string | null
  requestFlowUrl?: string | null
  categoryId?: string | null
}): string | null {
  const fromId = input.categoryId?.trim() ?? ""
  if (fromId) return fromId
  for (const raw of [input.listingUrl, input.requestFlowUrl]) {
    const value = raw?.trim() ?? ""
    if (!value || !isSafeHttpUrl(value)) continue
    try {
      const url = new URL(value)
      const pk =
        url.searchParams.get("category_pk")?.trim() ||
        url.searchParams.get("categoryID")?.trim() ||
        url.searchParams.get("categoryId")?.trim() ||
        ""
      if (pk) return pk
    } catch {
      /* continue */
    }
  }
  return null
}

/**
 * Official Service Page Widget embed URL for an iframe.
 * @see https://developers.thumbtack.com/docs/marketplace/widgets/service-page
 *
 * Public thumbtack.com/…/service/… pages refuse iframes ("refused to connect").
 * Only `/embed/service-page` (with iframe_id) is frameable.
 */
export function resolveThumbtackServicePageEmbedUrl(input: {
  listingUrl?: string | null
  requestFlowUrl?: string | null
  providerRef?: string | null
  categoryId?: string | null
  zipCode?: string | null
  iframeId?: string | null
  utmSource?: string | null
}): string | null {
  const iframeId =
    (input.iframeId?.trim() || THUMBTACK_SERVICE_PAGE_IFRAME_ID).trim() ||
    THUMBTACK_SERVICE_PAGE_IFRAME_ID
  const utm = normalizeThumbtackUtmSource(input.utmSource)

  const listing = input.listingUrl?.trim() ?? ""
  if (listing && isSafeHttpUrl(listing)) {
    try {
      const parsed = new URL(listing)
      if (isServicePageEmbedPath(parsed.pathname)) {
        parsed.searchParams.set("iframe_id", iframeId)
        parsed.searchParams.set("utm_source", utm)
        if (!parsed.searchParams.get("utm_medium")) {
          parsed.searchParams.set("utm_medium", "partnership")
        }
        const zip = input.zipCode?.trim()
        if (zip && !parsed.searchParams.get("zip_code")) {
          parsed.searchParams.set("zip_code", zip)
        }
        // Prefer thumbtack.com host (docs); www public pages often refuse frames.
        if (parsed.hostname === "www.thumbtack.com") {
          parsed.hostname = "thumbtack.com"
        }
        return parsed.toString()
      }
    } catch {
      /* fall through to construct */
    }
  }

  const servicePk = extractThumbtackServicePk({
    listingUrl: input.listingUrl,
    providerRef: input.providerRef,
  })
  const categoryPk = extractThumbtackCategoryPk({
    listingUrl: input.listingUrl,
    requestFlowUrl: input.requestFlowUrl,
    categoryId: input.categoryId,
  })
  if (!servicePk || !categoryPk) return null

  const url = new URL("https://thumbtack.com/embed/service-page")
  url.searchParams.set("category_pk", categoryPk)
  url.searchParams.set("service_pk", servicePk)
  url.searchParams.set("utm_source", utm)
  url.searchParams.set("utm_medium", "partnership")
  url.searchParams.set("iframe_id", iframeId)
  const zip = input.zipCode?.trim()
  if (zip) url.searchParams.set("zip_code", zip)
  return url.toString()
}
