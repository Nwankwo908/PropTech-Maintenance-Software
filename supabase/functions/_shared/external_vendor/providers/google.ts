import type {
  ExternalVendorHit,
  ExternalVendorProvider,
  ExternalVendorSearchInput,
} from "../types.ts"

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

export class GooglePlacesExternalVendorProvider implements ExternalVendorProvider {
  readonly id = "google" as const

  constructor(private readonly apiKey: string) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey.trim())
  }

  async search(input: ExternalVendorSearchInput): Promise<ExternalVendorHit[]> {
    if (!this.isConfigured()) return []

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey.trim(),
        "X-Goog-FieldMask":
          "places.displayName,places.rating,places.userRatingCount,places.priceLevel",
      },
      body: JSON.stringify({
        textQuery: input.textQuery,
        languageCode: "en",
        maxResultCount: 6,
      }),
    })

    if (!res.ok) {
      const t = await res.text().catch(() => "")
      console.warn("[external-vendor/google] HTTP", res.status, t.slice(0, 200))
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

    const out: ExternalVendorHit[] = []
    for (const p of data.places ?? []) {
      const name = String(p.displayName?.text ?? "").trim()
      if (!name) continue
      out.push({
        name,
        rating: typeof p.rating === "number" ? p.rating : null,
        reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        priceLabel: googlePriceLabel(p.priceLevel),
        source: "google",
      })
    }
    return out
  }
}
