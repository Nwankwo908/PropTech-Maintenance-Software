import type {
  ExternalVendorHit,
  ExternalVendorProvider,
  ExternalVendorSearchInput,
} from "../types.ts"

/** Normalize NetVendor / partner API vendor records into ExternalVendorHit. */
export function parseNetVendorRecords(
  records: unknown[],
  source: "netvendor" | "mock" = "netvendor",
): ExternalVendorHit[] {
  const out: ExternalVendorHit[] = []
  for (const raw of records) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    const name = pickString(row, ["name", "vendorName", "vendor_name", "companyName", "company_name"])
    if (!name) continue

    const rating = pickNumber(row, ["rating", "vendorRating", "vendor_rating", "score"])
    const reviewCount = pickNumber(row, [
      "reviewCount",
      "review_count",
      "reviews",
      "ratingCount",
      "rating_count",
    ])
    const providerRef = pickString(row, ["id", "vendorId", "vendor_id", "integrationId", "integration_id"])
    const compliance = pickString(row, [
      "complianceStatus",
      "compliance_status",
      "credentialStatus",
      "credential_status",
    ])
    const priceRaw = pickString(row, ["priceLabel", "price_label", "priceLevel", "price_level"])
    const priceLabel = compliance
      ? `${compliance} · ${priceRaw ?? "Credentialed"}`
      : priceRaw ?? (source === "netvendor" ? "NetVendor · Compliant" : null)

    out.push({
      name,
      rating,
      reviewCount,
      priceLabel,
      source,
      providerRef: providerRef || null,
      etaMinutes: pickNumber(row, ["etaMinutes", "eta_minutes", "responseMinutes", "response_minutes"]),
    })
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

function pickNumber(row: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string" && v.trim()) {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

const MOCK_BY_TRADE: Record<string, ExternalVendorHit[]> = {
  plumbing: [
    {
      name: "Credentialed Flow Plumbing",
      rating: 4.9,
      reviewCount: 186,
      priceLabel: "Compliant · Credentialed",
      source: "netvendor",
      providerRef: "nv-mock-plumb-1",
      etaMinutes: 22,
    },
    {
      name: "Verified Pipe & Drain Co.",
      rating: 4.7,
      reviewCount: 94,
      priceLabel: "Compliant · Insurance verified",
      source: "netvendor",
      providerRef: "nv-mock-plumb-2",
      etaMinutes: 35,
    },
  ],
  electrical: [
    {
      name: "Compliant Spark Electric",
      rating: 4.8,
      reviewCount: 142,
      priceLabel: "Compliant · COI on file",
      source: "netvendor",
      providerRef: "nv-mock-elec-1",
      etaMinutes: 40,
    },
  ],
  hvac: [
    {
      name: "NetClimate HVAC Services",
      rating: 4.8,
      reviewCount: 211,
      priceLabel: "Compliant · Preferred vendor",
      source: "netvendor",
      providerRef: "nv-mock-hvac-1",
      etaMinutes: 45,
    },
  ],
  default: [
    {
      name: "Verified Property Services",
      rating: 4.6,
      reviewCount: 77,
      priceLabel: "Compliant · Credentialed",
      source: "netvendor",
      providerRef: "nv-mock-gen-1",
      etaMinutes: 30,
    },
  ],
}

function mockTradeKey(issueCategory: string | null): string {
  const c = String(issueCategory ?? "").trim().toLowerCase()
  if (c.includes("plumb")) return "plumbing"
  if (c.includes("hvac") || c.includes("heat") || c.includes("air")) return "hvac"
  if (c.includes("electric")) return "electrical"
  return "default"
}

/** Deterministic NetVendor-shaped suggestions when live API is unavailable. */
export class NetVendorMockExternalVendorProvider implements ExternalVendorProvider {
  readonly id = "netvendor" as const

  isConfigured(): boolean {
    return true
  }

  async search(input: ExternalVendorSearchInput): Promise<ExternalVendorHit[]> {
    const key = mockTradeKey(input.issueCategory)
    return MOCK_BY_TRADE[key] ?? MOCK_BY_TRADE.default
  }
}

export type NetVendorProviderOptions = {
  apiKey: string
  baseUrl: string
  searchPath?: string
  accountId?: string | null
  /** When true, use mock hits instead of HTTP (dev/demo). */
  forceMock?: boolean
}

/**
 * NetVendor vendor sourcing (partner API).
 * Configure NETVENDOR_API_BASE_URL + NETVENDOR_API_KEY from your NetVendor integration contact.
 *
 * Expected search contract (POST JSON):
 * { trade, location, issueCategory, complianceStatus: "compliant", limit }
 * Response: { vendors | results | data: VendorRecord[] }
 */
export class NetVendorExternalVendorProvider implements ExternalVendorProvider {
  readonly id = "netvendor" as const
  private readonly mock: NetVendorMockExternalVendorProvider

  constructor(private readonly opts: NetVendorProviderOptions) {
    this.mock = new NetVendorMockExternalVendorProvider()
  }

  isConfigured(): boolean {
    if (this.opts.forceMock) return true
    return Boolean(this.opts.apiKey.trim() && this.opts.baseUrl.trim())
  }

  async search(input: ExternalVendorSearchInput): Promise<ExternalVendorHit[]> {
    if (this.opts.forceMock) {
      return this.mock.search(input)
    }
    if (!this.isConfigured()) return []

    const base = this.opts.baseUrl.trim().replace(/\/$/, "")
    const path = (this.opts.searchPath?.trim() || "/v1/vendors/search").replace(/^\/?/, "/")
    const url = `${base}${path}`

    const body: Record<string, unknown> = {
      trade: input.tradeTerms,
      location: input.searchLocation,
      issueCategory: input.issueCategory,
      complianceStatus: "compliant",
      limit: 6,
    }
    const accountId = this.opts.accountId?.trim()
    if (accountId) body.accountId = accountId

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey.trim()}`,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const t = await res.text().catch(() => "")
      console.warn("[external-vendor/netvendor] HTTP", res.status, t.slice(0, 200))
      return []
    }

    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      console.warn("[external-vendor/netvendor] invalid JSON")
      return []
    }

    const records = extractNetVendorList(parsed)
    return parseNetVendorRecords(records, "netvendor")
  }
}

function extractNetVendorList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (!parsed || typeof parsed !== "object") return []
  const obj = parsed as Record<string, unknown>
  for (const key of ["vendors", "results", "data", "items", "matches"]) {
    const v = obj[key]
    if (Array.isArray(v)) return v
  }
  return []
}

export function netVendorProviderFromEnv(opts?: {
  forceMock?: boolean
}): NetVendorExternalVendorProvider {
  return new NetVendorExternalVendorProvider({
    apiKey: Deno.env.get("NETVENDOR_API_KEY")?.trim() ?? "",
    baseUrl: Deno.env.get("NETVENDOR_API_BASE_URL")?.trim() ?? "",
    searchPath: Deno.env.get("NETVENDOR_SEARCH_PATH")?.trim() || undefined,
    accountId: Deno.env.get("NETVENDOR_ACCOUNT_ID")?.trim() || null,
    forceMock: opts?.forceMock ||
      (Deno.env.get("NETVENDOR_USE_MOCK") ?? "").trim().toLowerCase() === "true",
  })
}
