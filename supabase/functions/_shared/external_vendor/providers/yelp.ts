import type {
  ExternalVendorHit,
  ExternalVendorProvider,
  ExternalVendorSearchInput,
} from "../types.ts"

export class YelpExternalVendorProvider implements ExternalVendorProvider {
  readonly id = "yelp" as const

  constructor(private readonly apiKey: string) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey.trim())
  }

  async search(input: ExternalVendorSearchInput): Promise<ExternalVendorHit[]> {
    if (!this.isConfigured()) return []

    const u = new URL("https://api.yelp.com/v3/businesses/search")
    u.searchParams.set("term", input.tradeTerms)
    u.searchParams.set("location", input.searchLocation)
    u.searchParams.set("limit", "6")

    const res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${this.apiKey.trim()}` },
    })

    if (!res.ok) {
      const t = await res.text().catch(() => "")
      console.warn("[external-vendor/yelp] HTTP", res.status, t.slice(0, 200))
      return []
    }

    const data = (await res.json()) as {
      businesses?: Array<{
        id?: string
        name?: string
        rating?: number
        review_count?: number
        price?: string
        phone?: string
        display_phone?: string
        url?: string
        location?: { display_address?: string[] }
      }>
    }

    const out: ExternalVendorHit[] = []
    for (const b of data.businesses ?? []) {
      const name = String(b.name ?? "").trim()
      if (!name) continue
      const price = typeof b.price === "string" && b.price.trim()
        ? `${b.price.trim()} on Yelp`
        : null
      const phone =
        (typeof b.display_phone === "string" && b.display_phone.trim()) ||
        (typeof b.phone === "string" && b.phone.trim()) ||
        null
      const listingUrl = typeof b.url === "string" && b.url.trim() ? b.url.trim() : null
      const address = Array.isArray(b.location?.display_address)
        ? b.location!.display_address!.map((p) => String(p).trim()).filter(Boolean).join(", ")
        : null
      out.push({
        name,
        rating: typeof b.rating === "number" ? b.rating : null,
        reviewCount: typeof b.review_count === "number" ? b.review_count : null,
        priceLabel: price,
        source: "yelp",
        providerRef: typeof b.id === "string" ? b.id : null,
        phone,
        listingUrl,
        address: address || null,
      })
    }
    return out
  }
}
