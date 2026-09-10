/**
 * Live rental market data for Ask Ulo market analysis.
 *
 * RapidAPI Zillow zillow-com1 (ZILLOW_RAPIDAPI_KEY) — for-rent listings
 *
 * Secrets (Edge, optional):
 *   ZILLOW_RAPIDAPI_KEY + optional ZILLOW_RAPIDAPI_HOST (default zillow-com1.p.rapidapi.com)
 */

import type { AskUloCitation } from "./searchInternalData.ts"

export type MarketComp = {
  address: string
  price: number | null
  bedrooms: number | null
  bathrooms: number | null
  squareFootage: number | null
  distanceMiles: number | null
  status: string | null
  /** Public listing / search URL when available. */
  url: string | null
  /** Listing source label (Zillow, Apartments.com, …). */
  source: string | null
}

export type MarketDataLookupResult = {
  available: boolean
  provider: "zillow_rapidapi" | null
  bullets: string[]
  citations: AskUloCitation[]
  comps: MarketComp[]
  estimatedRent: number | null
  rentRangeLow: number | null
  rentRangeHigh: number | null
  gapNote: string | null
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim()) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asStr(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t || null
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`
}

/** Build a public for-rent search URL so comps are always inspectable. */
export function rentalListingUrl(address: string, preferred: "zillow" | "google" = "zillow"): string {
  const q = address.trim()
  if (!q) return "https://www.zillow.com/homes/for_rent/"
  if (preferred === "google") {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q + " apartments for rent")}`
  }
  const slug = q.replace(/,/g, "").replace(/\s+/g, "-")
  return `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/`
}

function withListingLink(comp: MarketComp, defaultSource: string): MarketComp {
  const source = comp.source?.trim() || defaultSource
  const url =
    comp.url?.trim() ||
    (comp.address ? rentalListingUrl(comp.address, "zillow") : null)
  return { ...comp, source, url }
}

export function resolveMarketSearchAddress(input: {
  buildingName: string | null
  cityLabel: string | null
  stateCode: string | null
  addressLine?: string | null
}): { address: string | null; city: string | null; state: string | null } {
  if (input.addressLine?.trim()) {
    return {
      address: input.addressLine.trim(),
      city: input.cityLabel,
      state: input.stateCode,
    }
  }
  // City/state only — listings search still works
  if (input.cityLabel && input.stateCode) {
    return {
      address: null,
      city: input.cityLabel,
      state: input.stateCode,
    }
  }
  return { address: null, city: null, state: null }
}

async function fetchZillowRapidApi(
  apiKey: string,
  host: string,
  location: string,
): Promise<{ rent: number | null; comps: MarketComp[] } | null> {
  // Unofficial RapidAPI Zillow search — best-effort.
  const url = new URL(`https://${host}/propertyExtendedSearch`)
  url.searchParams.set("location", location)
  url.searchParams.set("status_type", "ForRent")
  url.searchParams.set("home_type", "Apartments")

  const res = await fetch(url, {
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": host,
    },
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    console.error("[ask_ulo/marketData] Zillow RapidAPI", res.status, data)
    return null
  }

  const props = Array.isArray(data.props)
    ? data.props
    : Array.isArray(data.results)
      ? data.results
      : []

  const comps: MarketComp[] = []
  const prices: number[] = []
  for (const raw of props.slice(0, 8)) {
    if (!raw || typeof raw !== "object") continue
    const c = raw as Record<string, unknown>
    const addr =
      asStr(c.address) ||
      [asStr(c.streetAddress), asStr(c.city), asStr(c.state)].filter(Boolean).join(", ")
    const price = asNum(c.price) ?? asNum(c.unformattedPrice) ?? asNum(c.rentZestimate)
    if (price != null) prices.push(price)
    if (!addr) continue
    comps.push({
      address: addr,
      price,
      bedrooms: asNum(c.bedrooms) ?? asNum(c.beds),
      bathrooms: asNum(c.bathrooms) ?? asNum(c.baths),
      squareFootage: asNum(c.livingArea) ?? asNum(c.sqft),
      distanceMiles: null,
      status: "ForRent",
      url: asStr(c.detailUrl)
        ? asStr(c.detailUrl)!.startsWith("http")
          ? asStr(c.detailUrl)
          : `https://www.zillow.com${asStr(c.detailUrl)}`
        : null,
      source: "Zillow",
    })
  }

  const avg =
    prices.length > 0
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : null

  return { rent: avg, comps: comps.map((c) => withListingLink(c, "Zillow")) }
}


function formatCompLine(c: MarketComp): string {
  const bits: string[] = [c.address]
  if (c.price != null) bits.push(money(c.price) + "/mo")
  if (c.bedrooms != null) bits.push(`${c.bedrooms} bd`)
  if (c.bathrooms != null) bits.push(`${c.bathrooms} ba`)
  if (c.squareFootage != null) bits.push(`${c.squareFootage.toLocaleString("en-US")} sqft`)
  if (c.distanceMiles != null) bits.push(`${c.distanceMiles.toFixed(1)} mi`)
  if (c.source) bits.push(c.source)
  if (c.url) bits.push(`[View Listing](${c.url})`)
  else if (c.status) bits.push(c.status)
  return `- ${bits.join(" · ")}`
}

/** Fetch live rental market packets for synthesis. */
export async function marketDataLookup(input: {
  buildingName: string | null
  cityLabel: string | null
  stateCode: string | null
  addressLine?: string | null
  /** Portfolio rent for positioning, if known. */
  portfolioMonthlyRent?: number | null
}): Promise<MarketDataLookupResult> {
  const zillowKey = Deno.env.get("ZILLOW_RAPIDAPI_KEY")?.trim()
  const rawHost = Deno.env.get("ZILLOW_RAPIDAPI_HOST")?.trim() || ""
  const zillowHost =
    rawHost && !rawHost.includes("zillow-property-data")
      ? rawHost.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : "zillow-com1.p.rapidapi.com"

  const loc = resolveMarketSearchAddress(input)
  if (!loc.address && !(loc.city && loc.state)) {
    return {
      available: false,
      provider: null,
      bullets: [],
      citations: [],
      comps: [],
      estimatedRent: null,
      rentRangeLow: null,
      rentRangeHigh: null,
      gapNote:
        "Need a property address or city/state to pull live rental market comps.",
    }
  }

  try {
    // Zillow RapidAPI (listing-level) when configured
    const location =
      loc.address ?? (loc.city && loc.state ? `${loc.city}, ${loc.state}` : null)
    if (location && zillowKey) {
      const z = await fetchZillowRapidApi(zillowKey, zillowHost, location)
      if (z && (z.rent != null || z.comps.length > 0)) {
        const bullets: string[] = [
          `Market data provider: Zillow (via RapidAPI) for ${location}.`,
        ]
        if (z.rent != null) {
          bullets.push(`Average listed rent nearby: ${money(z.rent)}/mo.`)
        }
        if (input.portfolioMonthlyRent != null && z.rent != null) {
          const delta = input.portfolioMonthlyRent - z.rent
          const pct = Math.round((delta / z.rent) * 100)
          bullets.push(
            `Portfolio rent position: current ~${money(input.portfolioMonthlyRent)}/mo vs avg listing ~${money(z.rent)}/mo ` +
              `(${pct >= 0 ? "+" : ""}${pct}%).`,
          )
        }
        if (z.comps.length) {
          bullets.push("Comparable rentals:")
          for (const c of z.comps.slice(0, 6)) bullets.push(formatCompLine(c))
        }

        return {
          available: true,
          provider: "zillow_rapidapi",
          bullets,
          citations: [
            {
              tool: "market_data",
              title: "Zillow for-rent listings",
              citation: location,
              url: "https://www.zillow.com/",
              excerpt: z.rent != null ? `Avg listing ${money(z.rent)}/mo` : "Live listings",
            },
          ],
          comps: z.comps,
          estimatedRent: z.rent,
          rentRangeLow: null,
          rentRangeHigh: null,
          gapNote: null,
        }
      }
    }

    return {
      available: false,
      provider: null,
      bullets: [],
      citations: [],
      comps: [],
      estimatedRent: null,
      rentRangeLow: null,
      rentRangeHigh: null,
      gapNote: `No live rental comps found for ${loc.address ?? `${loc.city}, ${loc.state}`}.`,
    }
  } catch (err) {
    console.error("[ask_ulo/marketData] threw", err)
    return {
      available: false,
      provider: null,
      bullets: [],
      citations: [],
      comps: [],
      estimatedRent: null,
      rentRangeLow: null,
      rentRangeHigh: null,
      gapNote: "Live market lookup failed. Try again shortly.",
    }
  }
}
