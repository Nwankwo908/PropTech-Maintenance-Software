import type {
  ExternalVendorHit,
  ExternalVendorProvider,
  ExternalVendorSearchInput,
} from "../types.ts"

const DEFAULT_API_BASE = "https://api.thumbtack.com/api"
const DEFAULT_TOKEN_URL = "https://auth.thumbtack.com/oauth2/token"
const DEFAULT_SCOPE =
  "demand::businesses/search.read demand::categories/request-form.read"

type TokenCache = {
  accessToken: string
  expiresAtMs: number
}

let tokenCache: TokenCache | null = null

export type ThumbtackProviderOptions = {
  clientId: string
  clientSecret: string
  apiBaseUrl?: string
  tokenUrl?: string
  oauthScope?: string
  utmSource?: string
}

export function extractZipFromLocation(location: string): string | null {
  const match = location.match(/\b(\d{5})(?:-\d{4})?\b/)
  return match?.[1] ?? null
}

export function parseThumbtackCategoryId(parsed: unknown, query: string): string | null {
  const rows = extractList(parsed)
  const needle = query.trim().toLowerCase()
  let fallback: string | null = null
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    const id = pickString(row, ["categoryID", "categoryId", "category_id", "id"])
    if (!id) continue
    const name = pickString(row, ["name", "categoryName", "category_name", "title"])
    if (!fallback) fallback = id
    if (name && (name.toLowerCase() === needle || name.toLowerCase().includes(needle))) {
      return id
    }
  }
  return fallback
}

type ThumbtackBusinessRaw = {
  businessID?: string
  businessName?: string
  rating?: number
  numberOfReviews?: number
  quote?: { startingCost?: number; costUnit?: string }
  businessLocation?: string
  servicePageURL?: string
  responseTimeHours?: number
  pills?: string[]
  isTopPro?: boolean
  isBusinessLicenseVerified?: boolean
  isBackgroundChecked?: boolean
  widgets?: { servicePageURL?: string }
}

export function parseThumbtackBusinesses(parsed: unknown): ExternalVendorHit[] {
  const rows = extractList(parsed)
  const out: ExternalVendorHit[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue
    const b = raw as ThumbtackBusinessRaw
    const name = String(b.businessName ?? "").trim()
    if (!name) continue
    const listingUrl =
      (typeof b.servicePageURL === "string" && b.servicePageURL.trim()) ||
      (typeof b.widgets?.servicePageURL === "string" && b.widgets.servicePageURL.trim()) ||
      null
    const tags = thumbtackTags(b)
    const licensed = Boolean(b.isBusinessLicenseVerified) ||
      tags.some((t) => t.toLowerCase() === "licensed")
    out.push({
      name,
      rating: typeof b.rating === "number" && Number.isFinite(b.rating) ? b.rating : null,
      reviewCount:
        typeof b.numberOfReviews === "number" && Number.isFinite(b.numberOfReviews)
          ? b.numberOfReviews
          : null,
      priceLabel: thumbtackPriceLabel(b.quote, licensed),
      source: "thumbtack",
      providerRef: typeof b.businessID === "string" && b.businessID.trim()
        ? b.businessID.trim()
        : null,
      etaMinutes: hoursToEtaMinutes(b.responseTimeHours),
      address: typeof b.businessLocation === "string" && b.businessLocation.trim()
        ? b.businessLocation.trim()
        : null,
      listingUrl,
      tags: tags.length > 0 ? tags : undefined,
    })
  }
  return out
}

function thumbtackTags(b: ThumbtackBusinessRaw): string[] {
  const tags: string[] = []
  if (b.isTopPro) tags.push("Top Pro")
  if (b.isBusinessLicenseVerified) tags.push("Licensed")
  if (b.isBackgroundChecked) tags.push("Background checked")
  for (const pill of b.pills ?? []) {
    const label = String(pill).replace(/_/g, " ").trim()
    if (!label) continue
    const titled = label.replace(/\b\w/g, (c) => c.toUpperCase())
    if (!tags.includes(titled)) tags.push(titled)
  }
  return tags.slice(0, 4)
}

function thumbtackPriceLabel(
  quote: ThumbtackBusinessRaw["quote"],
  licensed: boolean,
): string | null {
  const unit = typeof quote?.costUnit === "string" && quote.costUnit.trim()
    ? quote.costUnit.trim()
    : null
  const cost = typeof quote?.startingCost === "number" && quote.startingCost > 0
    ? `From $${Math.round(quote.startingCost)}`
    : null
  const quoteBit = [cost, unit].filter(Boolean).join(" · ") || null
  if (licensed && quoteBit) return `Licensed · ${quoteBit}`
  if (licensed) return "Licensed · Thumbtack"
  return quoteBit ? `${quoteBit} · Thumbtack` : "Thumbtack"
}

function hoursToEtaMinutes(hours: number | undefined): number | null {
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0) return null
  return Math.max(1, Math.round(hours * 60))
}

function extractList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (!parsed || typeof parsed !== "object") return []
  const obj = parsed as Record<string, unknown>
  for (const key of ["data", "businesses", "categories", "results", "items"]) {
    const v = obj[key]
    if (Array.isArray(v)) return v
  }
  return []
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
}

export class ThumbtackExternalVendorProvider implements ExternalVendorProvider {
  readonly id = "thumbtack" as const

  constructor(private readonly opts: ThumbtackProviderOptions) {}

  isConfigured(): boolean {
    return Boolean(this.opts.clientId.trim() && this.opts.clientSecret.trim())
  }

  async search(input: ExternalVendorSearchInput): Promise<ExternalVendorHit[]> {
    if (!this.isConfigured()) return []
    const zip = extractZipFromLocation(input.searchLocation)
    if (!zip) {
      console.warn("[external-vendor/thumbtack] no ZIP in search location")
      return []
    }

    const token = await this.accessToken()
    if (!token) return []

    const categoryID = await this.resolveCategoryId(token, input)
    if (!categoryID) {
      console.warn("[external-vendor/thumbtack] no category for", input.tradeTerms)
      return []
    }

    const apiBase = (this.opts.apiBaseUrl?.trim() || DEFAULT_API_BASE).replace(/\/$/, "")
    const utmSource = this.opts.utmSource?.trim() || "ulo"
    const res = await fetch(`${apiBase}/v4/businesses/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        categoryID,
        zipCode: zip,
        limit: 8,
        utmData: { utm_source: utmSource },
      }),
    })

    if (!res.ok) {
      const t = await res.text().catch(() => "")
      console.warn("[external-vendor/thumbtack] search HTTP", res.status, t.slice(0, 240))
      return []
    }

    const parsed = await res.json().catch(() => null)
    if (parsed == null) {
      console.warn("[external-vendor/thumbtack] invalid JSON")
      return []
    }
    return parseThumbtackBusinesses(parsed)
  }

  private async resolveCategoryId(
    token: string,
    input: ExternalVendorSearchInput,
  ): Promise<string | null> {
    const apiBase = (this.opts.apiBaseUrl?.trim() || DEFAULT_API_BASE).replace(/\/$/, "")
    const query = (input.tradeTerms || input.issueCategory || "home repair").trim()
    const url = new URL(`${apiBase}/v4/categories/search`)
    url.searchParams.set("searchQuery", query)
    url.searchParams.set("limit", "8")

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      console.warn("[external-vendor/thumbtack] categories HTTP", res.status, t.slice(0, 200))
      return null
    }
    const parsed = await res.json().catch(() => null)
    return parseThumbtackCategoryId(parsed, query)
  }

  private async accessToken(): Promise<string | null> {
    const now = Date.now()
    if (tokenCache && tokenCache.expiresAtMs > now + 15_000) {
      return tokenCache.accessToken
    }

    const tokenUrl = this.opts.tokenUrl?.trim() || DEFAULT_TOKEN_URL
    const scope = this.opts.oauthScope?.trim() || DEFAULT_SCOPE
    const basic = btoa(`${this.opts.clientId.trim()}:${this.opts.clientSecret.trim()}`)
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      audience: "urn:partner-api",
      scope,
    })

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      console.warn("[external-vendor/thumbtack] token HTTP", res.status, t.slice(0, 200))
      return null
    }
    const data = (await res.json().catch(() => null)) as {
      access_token?: string
      expires_in?: number
    } | null
    const accessToken = typeof data?.access_token === "string" ? data.access_token.trim() : ""
    if (!accessToken) return null
    const ttlSec = typeof data?.expires_in === "number" && data.expires_in > 60
      ? data.expires_in
      : 3600
    tokenCache = {
      accessToken,
      expiresAtMs: now + ttlSec * 1000,
    }
    return accessToken
  }
}

export function thumbtackProviderFromEnv(): ThumbtackExternalVendorProvider {
  return new ThumbtackExternalVendorProvider({
    clientId: Deno.env.get("THUMBTACK_CLIENT_ID")?.trim() ?? "",
    clientSecret: Deno.env.get("THUMBTACK_CLIENT_SECRET")?.trim() ?? "",
    apiBaseUrl: Deno.env.get("THUMBTACK_API_BASE_URL")?.trim() || undefined,
    tokenUrl: Deno.env.get("THUMBTACK_TOKEN_URL")?.trim() || undefined,
    oauthScope: Deno.env.get("THUMBTACK_OAUTH_SCOPE")?.trim() || undefined,
    utmSource: Deno.env.get("THUMBTACK_UTM_SOURCE")?.trim() || undefined,
  })
}
