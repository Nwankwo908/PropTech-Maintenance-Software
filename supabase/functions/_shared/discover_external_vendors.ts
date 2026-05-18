/**
 * Merge Google Places Text Search (New) + Yelp Fusion business search into
 * deduplicated suggestions for admin UI when no in-network vendor matches.
 */

export type ExternalVendorSuggestion = {
  name: string
  rating: number | null
  reviewCount: number | null
  priceLabel: string | null
  sources: ("google" | "yelp")[]
}

type MutableAgg = {
  name: string
  rating: number | null
  reviewCount: number | null
  priceLabel: string | null
  sources: Set<"google" | "yelp">
}

function tradeTermsFromCategory(issueCategory: string | null | undefined): string {
  const c = String(issueCategory ?? "").trim().toLowerCase()
  if (!c) return "home maintenance repair"
  if (c.includes("plumb")) return "plumbing contractor"
  if (c.includes("hvac") || c.includes("heat") || c.includes("air")) {
    return "HVAC air conditioning heating"
  }
  if (c.includes("electric")) return "electrical contractor"
  if (c.includes("appliance")) return "appliance repair"
  if (c.includes("door") || c.includes("window")) return "door window repair"
  return `${c} repair service`
}

function compactKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 48)
}

function googlePriceLabel(level: string | null | undefined): string | null {
  if (!level) return null
  const m: Record<string, string> = {
    PRICE_LEVEL_FREE: "Free",
    PRICE_LEVEL_INEXPENSIVE: "$ · Inexpensive",
    PRICE_LEVEL_MODERATE: "$$ · Moderate",
    PRICE_LEVEL_EXPENSIVE: "$$$ · Expensive",
    PRICE_LEVEL_VERY_EXPENSIVE: "$$$$ · Very expensive",
  }
  return m[level] ?? null
}

async function googleTextSearch(
  textQuery: string,
  apiKey: string,
): Promise<Pick<MutableAgg, "name" | "rating" | "reviewCount" | "priceLabel">[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.rating,places.userRatingCount,places.priceLevel",
    },
    body: JSON.stringify({
      textQuery,
      languageCode: "en",
      maxResultCount: 6,
    }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => "")
    console.warn("[discover-external] Google Places HTTP", res.status, t.slice(0, 200))
    return []
  }
  const data = (await res.json()) as {
    places?: Array<{
      displayName?: { text?: string }
      rating?: number
      userRatingCount?: number
      priceLevel?: string
    }>
  }
  const out: Pick<MutableAgg, "name" | "rating" | "reviewCount" | "priceLabel">[] = []
  for (const p of data.places ?? []) {
    const name = String(p.displayName?.text ?? "").trim()
    if (!name) continue
    out.push({
      name,
      rating: typeof p.rating === "number" ? p.rating : null,
      reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
      priceLabel: googlePriceLabel(p.priceLevel),
    })
  }
  return out
}

async function yelpBusinessSearch(
  term: string,
  location: string,
  apiKey: string,
): Promise<Pick<MutableAgg, "name" | "rating" | "reviewCount" | "priceLabel">[]> {
  const u = new URL("https://api.yelp.com/v3/businesses/search")
  u.searchParams.set("term", term)
  u.searchParams.set("location", location)
  u.searchParams.set("limit", "6")
  const res = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    const t = await res.text().catch(() => "")
    console.warn("[discover-external] Yelp HTTP", res.status, t.slice(0, 200))
    return []
  }
  const data = (await res.json()) as {
    businesses?: Array<{
      name?: string
      rating?: number
      review_count?: number
      price?: string
    }>
  }
  const out: Pick<MutableAgg, "name" | "rating" | "reviewCount" | "priceLabel">[] = []
  for (const b of data.businesses ?? []) {
    const name = String(b.name ?? "").trim()
    if (!name) continue
    const price = typeof b.price === "string" && b.price.trim() ? `${b.price.trim()} on Yelp` : null
    out.push({
      name,
      rating: typeof b.rating === "number" ? b.rating : null,
      reviewCount: typeof b.review_count === "number" ? b.review_count : null,
      priceLabel: price,
    })
  }
  return out
}

function mergeHits(
  google: Pick<MutableAgg, "name" | "rating" | "reviewCount" | "priceLabel">[],
  yelp: Pick<MutableAgg, "name" | "rating" | "reviewCount" | "priceLabel">[],
): ExternalVendorSuggestion[] {
  const byKey = new Map<string, MutableAgg>()
  function upsert(
    row: Pick<MutableAgg, "name" | "rating" | "reviewCount" | "priceLabel">,
    source: "google" | "yelp",
  ) {
    const key = compactKey(row.name)
    if (!key) return
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, {
        name: row.name,
        rating: row.rating,
        reviewCount: row.reviewCount,
        priceLabel: row.priceLabel,
        sources: new Set([source]),
      })
      return
    }
    prev.sources.add(source)
    const rc = (a: number | null, b: number | null) =>
      (a ?? 0) >= (b ?? 0) ? a : b
    prev.reviewCount = rc(prev.reviewCount, row.reviewCount)
    const ra = (a: number | null, b: number | null) => {
      if (a == null) return b
      if (b == null) return a
      return a >= b ? a : b
    }
    prev.rating = ra(prev.rating, row.rating)
    if (!prev.priceLabel && row.priceLabel) prev.priceLabel = row.priceLabel
    else if (prev.priceLabel && row.priceLabel && !prev.priceLabel.includes("Yelp") && row.priceLabel.includes("Yelp")) {
      prev.priceLabel = `${prev.priceLabel}; ${row.priceLabel}`
    }
  }
  for (const g of google) upsert(g, "google")
  for (const y of yelp) upsert(y, "yelp")

  const list = [...byKey.values()].map((m) => ({
    name: m.name,
    rating: m.rating,
    reviewCount: m.reviewCount,
    priceLabel: m.priceLabel,
    sources: [...m.sources],
  }))

  function score(s: ExternalVendorSuggestion): number {
    const r = s.rating ?? 0
    const c = s.reviewCount ?? 0
    return r * Math.log10(c + 10)
  }
  list.sort((a, b) => score(b) - score(a))
  return list.slice(0, 8)
}

export type DiscoverExternalVendorsInput = {
  issueCategory: string | null
  /** Short location phrase, e.g. "Austin, TX" or "90210". */
  searchLocation: string
  googleApiKey: string | null
  yelpApiKey: string | null
}

export async function discoverExternalVendorsMerged(
  input: DiscoverExternalVendorsInput,
): Promise<ExternalVendorSuggestion[]> {
  const loc = input.searchLocation.trim() || "United States"
  const trade = tradeTermsFromCategory(input.issueCategory)
  const textQuery = `${trade} near ${loc}`

  const googleKey = input.googleApiKey?.trim() || null
  const yelpKey = input.yelpApiKey?.trim() || null

  const [g, y] = await Promise.all([
    googleKey ? googleTextSearch(textQuery, googleKey) : Promise.resolve([]),
    yelpKey ? yelpBusinessSearch(trade, loc, yelpKey) : Promise.resolve([]),
  ])

  return mergeHits(g, y)
}
