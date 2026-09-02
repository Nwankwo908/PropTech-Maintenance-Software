import type {
  ExternalVendorHit,
  ExternalVendorProvider,
  ExternalVendorSearchInput,
} from "../types.ts"
import {
  clampExternalVendorSearchLimit,
  EXTERNAL_VENDOR_SEARCH_LIMIT,
  EXTERNAL_VENDOR_SEARCH_RADIUS_MILES,
} from "../../../../../shared/externalVendor/searchLimit.ts"

const DEFAULT_API_BASE = "https://api.thumbtack.com/api"
const DEFAULT_TOKEN_URL = "https://auth.thumbtack.com/oauth2/token"
/** Search + category lookup — enough to list pros. */
export const THUMBTACK_SEARCH_OAUTH_SCOPE =
  "demand::businesses/search.read demand::categories/request-form.read"
/** Opening a conversation and sending messages. */
export const THUMBTACK_MESSAGING_OAUTH_SCOPE =
  "demand::requests.write demand::negotiations.read demand::negotiations/messages.write"
const DEFAULT_SCOPE = `${THUMBTACK_SEARCH_OAUTH_SCOPE} ${THUMBTACK_MESSAGING_OAUTH_SCOPE}`

type TokenCache = {
  accessToken: string
  expiresAtMs: number
  scope: string
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

export function mergeThumbtackOauthScopes(...chunks: string[]): string {
  const parts = new Set<string>()
  for (const chunk of chunks) {
    for (const token of chunk.split(/\s+/)) {
      if (token) parts.add(token)
    }
  }
  return [...parts].join(" ")
}

export function thumbtackScopeAllowsMessaging(scope: string): boolean {
  return /\bdemand::requests\.write\b/.test(scope)
}

export function thumbtackOpenConversationError(status: number, bodyText?: string): string {
  if (bodyText === "oauth_token_failed" || status === 401) {
    return "Thumbtack did not allow this conversation. Listing pros still works — messaging has to be enabled on the Thumbtack partner account."
  }
  return `Thumbtack could not open this conversation (${status}).`
}

export function extractZipFromLocation(location: string): string | null {
  const match = location.match(/\b(\d{5})(?:-\d{4})?\b/)
  return match?.[1] ?? null
}

/** Partner widgets require utm_source to start with `cma-`. */
export function normalizeThumbtackUtmSource(raw: string | null | undefined): string {
  const v = (raw ?? "").trim() || "ulo"
  if (v.toLowerCase().startsWith("cma-")) return v
  return `cma-${v}`
}

export function parseThumbtackCategoryId(parsed: unknown, query: string): string | null {
  const rows = extractList(parsed)
  const needle = query.trim().toLowerCase()
  if (!needle) return null
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    const id = pickString(row, ["categoryID", "categoryId", "category_id", "id"])
    if (!id) continue
    const name = pickString(row, ["name", "categoryName", "category_name", "title"]).toLowerCase()
    if (!name) continue
    if (name === needle || name.includes(needle)) return id
    const words = needle.split(/\s+/).filter((w) => w.length > 2)
    if (words.length > 0 && words.every((w) => name.includes(w))) return id
  }
  return null
}

type ThumbtackBusinessRaw = {
  businessID?: string
  businessName?: string
  rating?: number
  numberOfReviews?: number
  quote?: { startingCost?: number; costUnit?: string }
  businessLocation?: string
  servicePageURL?: string
  businessImageURL?: string
  imageURL?: string
  responseTimeHours?: number
  pills?: string[]
  isTopPro?: boolean
  isBusinessLicenseVerified?: boolean
  isBackgroundChecked?: boolean
  widgets?: { servicePageURL?: string }
}

export function thumbtackIdsFromListingUrl(listingUrl: string | null | undefined): {
  searchId: string | null
  categoryId: string | null
} {
  const raw = listingUrl?.trim() ?? ""
  if (!raw) return { searchId: null, categoryId: null }
  try {
    const url = new URL(raw)
    return {
      searchId: url.searchParams.get("project_pk")?.trim() ||
        url.searchParams.get("searchID")?.trim() ||
        null,
      categoryId: url.searchParams.get("category_pk")?.trim() ||
        url.searchParams.get("categoryID")?.trim() ||
        null,
    }
  } catch {
    return { searchId: null, categoryId: null }
  }
}

export function parseThumbtackSearchContext(parsed: unknown): {
  searchId: string | null
  categoryId: string | null
} {
  if (!parsed || typeof parsed !== "object") return { searchId: null, categoryId: null }
  const obj = parsed as Record<string, unknown>
  const searchId = pickString(obj, ["searchID", "searchId", "search_id"])
  const meta = obj.metadata && typeof obj.metadata === "object"
    ? obj.metadata as Record<string, unknown>
    : null
  const categoryId = meta
    ? pickString(meta, ["categoryID", "categoryId", "category_id"])
    : ""
  return { searchId: searchId || null, categoryId: categoryId || null }
}

export function parseThumbtackBusinesses(parsed: unknown): ExternalVendorHit[] {
  const rows = extractList(parsed)
  const out: ExternalVendorHit[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue
    const b = raw as ThumbtackBusinessRaw
    const name =
      pickString(b as Record<string, unknown>, ["businessName", "name", "business_name"]) ||
      String(b.businessName ?? "").trim()
    if (!name) continue
    const listingUrl =
      (typeof b.servicePageURL === "string" && b.servicePageURL.trim()) ||
      (typeof b.widgets?.servicePageURL === "string" && b.widgets.servicePageURL.trim()) ||
      null
    const tags = thumbtackTags(b)
    const licensed = Boolean(b.isBusinessLicenseVerified) ||
      tags.some((t) => t.toLowerCase() === "licensed")
    const fromUrl = thumbtackIdsFromListingUrl(listingUrl)
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
      searchId: fromUrl.searchId,
      categoryId: fromUrl.categoryId,
      imageUrl: pickHttpUrl(b as Record<string, unknown>, [
        "businessImageURL",
        "businessImageUrl",
        "imageURL",
        "imageUrl",
        "profileImageURL",
        "profileImageUrl",
      ]),
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
    if (v && typeof v === "object") {
      const nested = extractList(v)
      if (nested.length > 0) return nested
    }
  }
  return []
}

function annotateThumbtackHits(
  hits: ExternalVendorHit[],
  parsed: unknown,
): ExternalVendorHit[] {
  const ctx = parseThumbtackSearchContext(parsed)
  return hits.map((hit) => ({
    ...hit,
    searchId: hit.searchId || ctx.searchId,
    categoryId: hit.categoryId || ctx.categoryId,
  }))
}

function mergeHits(limit: number, groups: ExternalVendorHit[][]): ExternalVendorHit[] {
  const out: ExternalVendorHit[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const hit of group) {
      const key = (hit.providerRef?.trim().toLowerCase() || hit.name.trim().toLowerCase())
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(hit)
      if (out.length >= limit) return out
    }
  }
  return out
}

export function buildThumbtackFilteredUserQuery(input: ExternalVendorSearchInput): string {
  const parts = [
    input.jobDescription?.trim(),
    input.tradeTerms?.trim() || input.issueCategory?.trim(),
    input.searchLocation?.trim(),
  ].filter((p): p is string => Boolean(p))
  return parts.join(". ") || "home repair"
}

function searchQueriesForInput(input: ExternalVendorSearchInput): string[] {
  const primary = (input.tradeTerms || input.issueCategory || "home repair").trim()
  const extras: string[] = []
  const slug = (input.issueCategory ?? "").trim().toLowerCase()
  if (slug.includes("appliance")) extras.push("appliance repair", "oven repair")
  else if (slug.includes("plumb")) extras.push("plumber", "plumbing")
  else if (slug.includes("electric")) extras.push("electrician", "electrical")
  else if (slug.includes("hvac")) extras.push("HVAC", "air conditioning")
  else if (slug.includes("general") || slug.includes("other")) extras.push("handyman")
  const out: string[] = []
  for (const q of [primary, ...extras]) {
    const t = q.trim()
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  return out
}

function pickString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return ""
}

function pickHttpUrl(row: Record<string, unknown>, keys: string[]): string | null {
  const raw = pickString(row, keys)
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.toString()
  } catch {
    return null
  }
}

const THUMBTACK_FETCH_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Ulo/1.0 (https://ulohome.io; Thumbtack demand partner)",
} as const

export class ThumbtackExternalVendorProvider implements ExternalVendorProvider {
  readonly id = "thumbtack" as const
  lastSearchError: string | null = null

  constructor(private readonly opts: ThumbtackProviderOptions) {}

  isConfigured(): boolean {
    return Boolean(this.opts.clientId.trim() && this.opts.clientSecret.trim())
  }

  partnerUtmSource(): string {
    return normalizeThumbtackUtmSource(this.opts.utmSource)
  }

  apiBase(): string {
    return (this.resolvedApiBase ?? this.opts.apiBaseUrl?.trim() ?? DEFAULT_API_BASE)
      .replace(/\/$/, "")
  }

  async getAccessToken(): Promise<string | null> {
    return await this.accessToken({
      scope: THUMBTACK_SEARCH_OAUTH_SCOPE,
      allowUnscopedFallback: true,
    })
  }

  /** Token that can POST /v4/requests — do not fall back to a search-only grant. */
  async getMessagingAccessToken(): Promise<string | null> {
    return await this.accessToken({
      scope: this.messagingScope(),
      allowUnscopedFallback: false,
    })
  }

  async search(input: ExternalVendorSearchInput): Promise<ExternalVendorHit[]> {
    this.lastSearchError = null
    if (!this.isConfigured()) {
      this.lastSearchError = "missing_credentials"
      console.warn("[external-vendor/thumbtack] missing client id/secret")
      return []
    }
    const zip = extractZipFromLocation(input.searchLocation)
    if (!zip) {
      this.lastSearchError = "missing_zip"
      console.warn("[external-vendor/thumbtack] no ZIP in search location", input.searchLocation)
      return []
    }

    const token = await this.accessToken({ allowUnscopedFallback: true })
    if (!token) {
      if (!this.lastSearchError) this.lastSearchError = "oauth_token_failed"
      console.warn("[external-vendor/thumbtack] OAuth token failed")
      return []
    }

    const apiBase = (
      this.resolvedApiBase ||
      this.opts.apiBaseUrl?.trim() ||
      DEFAULT_API_BASE
    ).replace(/\/$/, "")
    const utmSource = normalizeThumbtackUtmSource(this.opts.utmSource)
    const limit = clampExternalVendorSearchLimit(input.limit ?? EXTERNAL_VENDOR_SEARCH_LIMIT)
    const queries = searchQueriesForInput(input)
    const categoryID = await this.resolveCategoryId(token, input, zip)
    const userQuery = buildThumbtackFilteredUserQuery(input)
    const groups: ExternalVendorHit[][] = []

    for (const searchQuery of queries) {
      if (mergeHits(limit, groups).length >= limit) break
      groups.push(await this.postBusinessesSearch(apiBase, token, {
        searchQuery,
        zipCode: zip,
        utmSource,
        limit,
      }))
    }

    if (mergeHits(limit, groups).length < limit) {
      groups.push(await this.postFilteredSearch(apiBase, token, {
        userQuery,
        zipCode: zip,
        utmSource,
        limit,
        categoryID: categoryID ?? undefined,
        tradeTerms: input.tradeTerms,
      }))
    }

    if (categoryID && mergeHits(limit, groups).length < limit) {
      groups.push(await this.postBusinessesSearch(apiBase, token, {
        categoryID,
        zipCode: zip,
        utmSource,
        limit,
      }))
    }

    const hits = mergeHits(limit, groups)
    if (hits.length > 0) {
      this.lastSearchError = null
      return hits
    }

    if (!this.lastSearchError) this.lastSearchError = "empty_results"
    console.warn("[external-vendor/thumbtack] no businesses", {
      zip,
      queries,
      hadCategory: Boolean(categoryID),
      lastSearchError: this.lastSearchError,
    })
    return []
  }

  private async postBusinessesSearch(
    apiBase: string,
    token: string,
    params: {
      zipCode: string
      utmSource: string
      limit: number
      searchQuery?: string
      categoryID?: string
    },
  ): Promise<ExternalVendorHit[]> {
    const body: Record<string, unknown> = {
      zipCode: params.zipCode,
      limit: params.limit,
      utmData: { utm_source: params.utmSource },
    }
    if (params.searchQuery) body.searchQuery = params.searchQuery
    if (params.categoryID) body.categoryID = params.categoryID

    const res = await fetch(`${apiBase}/v4/businesses/search`, {
      method: "POST",
      headers: {
        ...THUMBTACK_FETCH_HEADERS,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    if (res.status === 202 || !res.ok) {
      const t = await res.text().catch(() => "")
      this.lastSearchError = `search_http_${res.status}`
      console.warn("[external-vendor/thumbtack] search HTTP", res.status, t.slice(0, 240))
      return []
    }

    const parsed = await res.json().catch(() => null)
    if (parsed == null) {
      console.warn("[external-vendor/thumbtack] invalid JSON")
      return []
    }
    const hits = annotateThumbtackHits(parseThumbtackBusinesses(parsed), parsed)
    const meta = parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)["metadata"]
      : null
    const categoryName =
      meta && typeof meta === "object"
        ? pickString(meta as Record<string, unknown>, ["categoryName", "category_name"])
        : ""
    console.log("[external-vendor/thumbtack] search ok", {
      zip: params.zipCode,
      searchQuery: params.searchQuery ?? null,
      usedCategory: Boolean(params.categoryID),
      categoryName: categoryName || null,
      count: hits.length,
    })
    return hits
  }

  private async postFilteredSearch(
    apiBase: string,
    token: string,
    params: {
      userQuery: string
      zipCode: string
      utmSource: string
      limit: number
      categoryID?: string
      tradeTerms?: string
    },
  ): Promise<ExternalVendorHit[]> {
    const payload: Record<string, unknown> = {
      userQuery: params.userQuery,
      zipCode: params.zipCode,
      limit: params.limit,
      utmData: { utm_source: params.utmSource },
      projectMetadata: {
        trade: params.tradeTerms ?? "",
        radiusMiles: EXTERNAL_VENDOR_SEARCH_RADIUS_MILES,
      },
    }
    if (params.categoryID) payload.categoryID = params.categoryID
    const res = await fetch(`${apiBase}/v4/businesses/search-filtered`, {
      method: "POST",
      headers: {
        ...THUMBTACK_FETCH_HEADERS,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
    if (res.status === 202 || !res.ok) {
      const t = await res.text().catch(() => "")
      this.lastSearchError = `search_filtered_http_${res.status}`
      console.warn("[external-vendor/thumbtack] search-filtered HTTP", res.status, t.slice(0, 240))
      return []
    }
    const parsed = await res.json().catch(() => null)
    if (parsed == null) return []
    const hits = annotateThumbtackHits(parseThumbtackBusinesses(parsed), parsed)
    console.log("[external-vendor/thumbtack] search-filtered ok", {
      zip: params.zipCode,
      count: hits.length,
    })
    return hits
  }

  private async resolveCategoryId(
    token: string,
    input: ExternalVendorSearchInput,
    zip: string,
  ): Promise<string | null> {
    const apiBase = (
      this.resolvedApiBase ||
      this.opts.apiBaseUrl?.trim() ||
      DEFAULT_API_BASE
    ).replace(/\/$/, "")
    const query = (input.tradeTerms || input.issueCategory || "home repair").trim()
    const url = new URL(`${apiBase}/v4/categories/search`)
    url.searchParams.set("searchQuery", query)
    url.searchParams.set("zipCode", zip)
    url.searchParams.set("limit", String(EXTERNAL_VENDOR_SEARCH_LIMIT))
    url.searchParams.set("utmData[utm_source]", normalizeThumbtackUtmSource(this.opts.utmSource))

    const res = await fetch(url.toString(), {
      headers: {
        ...THUMBTACK_FETCH_HEADERS,
        Authorization: `Bearer ${token}`,
      },
    })
    if (!res.ok) {
      const t = await res.text().catch(() => "")
      console.warn("[external-vendor/thumbtack] categories HTTP", res.status, t.slice(0, 200))
      return null
    }
    const parsed = await res.json().catch(() => null)
    return parseThumbtackCategoryId(parsed, query)
  }

  private resolvedApiBase: string | null = null

  private messagingScope(): string {
    return mergeThumbtackOauthScopes(
      this.opts.oauthScope?.trim() || DEFAULT_SCOPE,
      THUMBTACK_MESSAGING_OAUTH_SCOPE,
    )
  }

  private async accessToken(opts?: {
    scope?: string
    allowUnscopedFallback?: boolean
  }): Promise<string | null> {
    const now = Date.now()
    const scope = opts?.scope?.trim() || this.opts.oauthScope?.trim() || DEFAULT_SCOPE
    const allowUnscopedFallback = opts?.allowUnscopedFallback !== false
    const needsMessaging = thumbtackScopeAllowsMessaging(scope)
    if (
      tokenCache &&
      tokenCache.expiresAtMs > now + 15_000 &&
      (!needsMessaging || thumbtackScopeAllowsMessaging(tokenCache.scope))
    ) {
      return tokenCache.accessToken
    }

    const configuredToken = this.opts.tokenUrl?.trim() || DEFAULT_TOKEN_URL
    const configuredApi = (this.opts.apiBaseUrl?.trim() || DEFAULT_API_BASE).replace(/\/$/, "")
    const attempts = [
      { tokenUrl: configuredToken, apiBase: configuredApi },
      {
        tokenUrl: "https://staging-auth.thumbtack.com/oauth2/token",
        apiBase: "https://staging-api.thumbtack.com/api",
      },
    ]

    const clientId = this.opts.clientId.trim()
    const clientSecret = this.opts.clientSecret.trim()
    const formWithScope = new URLSearchParams({
      grant_type: "client_credentials",
      audience: "urn:partner-api",
      scope,
    })
    const formNoScope = new URLSearchParams({
      grant_type: "client_credentials",
      audience: "urn:partner-api",
    })
    const basic = btoa(`${clientId}:${clientSecret}`)

    let lastStatus = 0
    for (const attempt of attempts) {
      const variants: Array<{
        headers: Record<string, string>
        body: URLSearchParams
        grantedScope: string
      }> = [
        {
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: formWithScope,
          grantedScope: scope,
        },
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            audience: "urn:partner-api",
            scope,
            client_id: clientId,
            client_secret: clientSecret,
          }),
          grantedScope: scope,
        },
      ]
      if (allowUnscopedFallback && !needsMessaging) {
        variants.splice(1, 0, {
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: formNoScope,
          grantedScope: "",
        })
      }
      for (const variant of variants) {
        const res = await fetch(attempt.tokenUrl, {
          method: "POST",
          headers: variant.headers,
          body: variant.body,
        })
        lastStatus = res.status
        if (!res.ok) {
          const t = await res.text().catch(() => "")
          console.warn("[external-vendor/thumbtack] token HTTP", res.status, t.slice(0, 200))
          continue
        }
        const data = (await res.json().catch(() => null)) as {
          access_token?: string
          expires_in?: number
          scope?: string
        } | null
        const accessToken = typeof data?.access_token === "string" ? data.access_token.trim() : ""
        if (!accessToken) continue
        const granted = typeof data?.scope === "string" && data.scope.trim()
          ? data.scope.trim()
          : variant.grantedScope
        if (needsMessaging && !thumbtackScopeAllowsMessaging(granted)) {
          console.warn("[external-vendor/thumbtack] token missing requests.write")
          continue
        }
        const ttlSec = typeof data?.expires_in === "number" && data.expires_in > 60
          ? data.expires_in
          : 3600
        tokenCache = {
          accessToken,
          expiresAtMs: now + ttlSec * 1000,
          scope: granted,
        }
        this.resolvedApiBase = attempt.apiBase
        return accessToken
      }
    }
    this.lastSearchError = `oauth_http_${lastStatus || "failed"}`
    return null
  }
}

export function thumbtackProviderFromEnv(): ThumbtackExternalVendorProvider {
  return new ThumbtackExternalVendorProvider({
    clientId: Deno.env.get("THUMBTACK_CLIENT_ID")?.trim() ?? "",
    clientSecret: Deno.env.get("THUMBTACK_CLIENT_SECRET")?.trim() ?? "",
    apiBaseUrl: Deno.env.get("THUMBTACK_API_BASE_URL")?.trim() || undefined,
    tokenUrl: Deno.env.get("THUMBTACK_TOKEN_URL")?.trim() || undefined,
    oauthScope: Deno.env.get("THUMBTACK_OAUTH_SCOPE")?.trim() || undefined,
    utmSource: normalizeThumbtackUtmSource(Deno.env.get("THUMBTACK_UTM_SOURCE")),
  })
}
