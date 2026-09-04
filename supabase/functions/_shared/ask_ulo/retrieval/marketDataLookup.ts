/**
 * Live rental market data for Ask Ulo market analysis.
 *
 * Priority:
 * 1. RentCast (RENTCAST_API_KEY) — address AVM + listing comps
 * 2. RapidAPI Zillow zillow-com1 (ZILLOW_RAPIDAPI_KEY) — for-rent listings
 *
 * Secrets (Edge, optional):
 *   RENTCAST_API_KEY — preferred for listing-level comps
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
  /** Listing source label (Zillow, RentCast, Apartments.com, …). */
  source: string | null
}

export type MarketDataLookupResult = {
  available: boolean
  provider: "rentcast" | "zillow_rapidapi" | null
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

async function fetchRentCastAvm(apiKey: string, address: string): Promise<{
  rent: number | null
  low: number | null
  high: number | null
  comps: MarketComp[]
} | null> {
  const url = new URL("https://api.rentcast.io/v1/avm/rent/long-term")
  url.searchParams.set("address", address)
  url.searchParams.set("compCount", "5")

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Api-Key": apiKey,
    },
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    console.error("[ask_ulo/marketData] RentCast AVM", res.status, data)
    return null
  }

  const compsRaw = Array.isArray(data.comparables) ? data.comparables : []
  const comps: MarketComp[] = []
  for (const raw of compsRaw.slice(0, 6)) {
    if (!raw || typeof raw !== "object") continue
    const c = raw as Record<string, unknown>
    const addr =
      asStr(c.formattedAddress) ||
      [asStr(c.addressLine1), asStr(c.city), asStr(c.state), asStr(c.zipCode)]
        .filter(Boolean)
        .join(", ")
    if (!addr) continue
    comps.push({
      address: addr,
      price: asNum(c.price),
      bedrooms: asNum(c.bedrooms),
      bathrooms: asNum(c.bathrooms),
      squareFootage: asNum(c.squareFootage),
      distanceMiles: asNum(c.distance),
      status: asStr(c.status),
      url: null,
      source: "RentCast",
    })
  }

  return {
    rent: asNum(data.rent),
    low: asNum(data.rentRangeLow),
    high: asNum(data.rentRangeHigh),
    comps: comps.map((c) => withListingLink(c, "RentCast")),
  }
}

async function fetchRentCastListings(
  apiKey: string,
  city: string,
  state: string,
): Promise<MarketComp[]> {
  const url = new URL("https://api.rentcast.io/v1/listings/rental/long-term")
  url.searchParams.set("city", city)
  url.searchParams.set("state", state)
  url.searchParams.set("status", "Active")
  url.searchParams.set("limit", "8")

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Api-Key": apiKey,
    },
  })
  const data = (await res.json()) as unknown
  if (!res.ok) {
    console.error("[ask_ulo/marketData] RentCast listings", res.status, data)
    return []
  }

  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).listings)
      ? ((data as Record<string, unknown>).listings as unknown[])
      : []

  const comps: MarketComp[] = []
  for (const raw of rows.slice(0, 8)) {
    if (!raw || typeof raw !== "object") continue
    const c = raw as Record<string, unknown>
    const addr =
      asStr(c.formattedAddress) ||
      [asStr(c.addressLine1), asStr(c.city), asStr(c.state), asStr(c.zipCode)]
        .filter(Boolean)
        .join(", ")
    if (!addr) continue
    comps.push({
      address: addr,
      price: asNum(c.price),
      bedrooms: asNum(c.bedrooms),
      bathrooms: asNum(c.bathrooms),
      squareFootage: asNum(c.squareFootage),
      distanceMiles: asNum(c.distance),
      status: asStr(c.status) ?? "Active",
      url: asStr(c.url) ?? asStr(c.listingUrl),
      source: "RentCast",
    })
  }
  return comps.map((c) => withListingLink(c, "RentCast"))
}

async function fetchZillowRapidApi(
  apiKey: string,
  host: string,
  location: string,
): Promise<{ rent: number | null; comps: MarketComp[] } | null> {
  // Unofficial RapidAPI Zillow search — best-effort; prefer RentCast when available.
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
  const rentcastKey = Deno.env.get("RENTCAST_API_KEY")?.trim()
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
    if (rentcastKey) {
      let rent: number | null = null
      let low: number | null = null
      let high: number | null = null
      let comps: MarketComp[] = []

      if (loc.address) {
        const avm = await fetchRentCastAvm(rentcastKey, loc.address)
        if (avm) {
          rent = avm.rent
          low = avm.low
          high = avm.high
          comps = avm.comps
        }
      }

      if (comps.length < 3 && loc.city && loc.state) {
        const listings = await fetchRentCastListings(rentcastKey, loc.city, loc.state)
        const seen = new Set(comps.map((c) => c.address.toLowerCase()))
        for (const l of listings) {
          if (seen.has(l.address.toLowerCase())) continue
          comps.push(l)
          if (comps.length >= 8) break
        }
        if (rent == null) {
          const prices = listings.map((l) => l.price).filter((p): p is number => p != null)
          if (prices.length) {
            rent = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
          }
        }
      }

      if (rent != null || comps.length > 0) {
        const bullets: string[] = []
        bullets.push(
          `Market data provider: RentCast (live rental AVM / listings)${
            loc.address ? ` for ${loc.address}` : ` near ${loc.city}, ${loc.state}`
          }.`,
        )
        if (rent != null) {
          bullets.push(
            `Estimated market rent: ${money(rent)}/mo` +
              (low != null && high != null
                ? ` (range ${money(low)}–${money(high)})`
                : "") +
              ".",
          )
        }
        if (input.portfolioMonthlyRent != null && rent != null) {
          const delta = input.portfolioMonthlyRent - rent
          const pct = Math.round((delta / rent) * 100)
          bullets.push(
            `Portfolio rent position: current ~${money(input.portfolioMonthlyRent)}/mo vs market ~${money(rent)}/mo ` +
              `(${pct >= 0 ? "+" : ""}${pct}% / ${delta >= 0 ? "+" : ""}${money(Math.abs(delta))}).`,
          )
        }
        if (comps.length) {
          bullets.push("Comparable rentals:")
          for (const c of comps.slice(0, 6)) bullets.push(formatCompLine(c))
        }

        return {
          available: true,
          provider: "rentcast",
          bullets,
          citations: [
            {
              tool: "market_data",
              title: "RentCast rental market",
              citation: loc.address ?? `${loc.city}, ${loc.state}`,
              url: "https://www.rentcast.io/",
              excerpt: rent != null ? `Est. rent ${money(rent)}/mo` : "Live rental comps",
            },
          ],
          comps,
          estimatedRent: rent,
          rentRangeLow: low,
          rentRangeHigh: high,
          gapNote: null,
        }
      }
    }

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
