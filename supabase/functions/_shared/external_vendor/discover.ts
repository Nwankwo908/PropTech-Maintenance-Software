import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { GooglePlacesExternalVendorProvider } from "./providers/google.ts"
import { MockExternalVendorProvider } from "./providers/mock.ts"
import { netVendorProviderFromEnv } from "./providers/netvendor.ts"
import { YelpExternalVendorProvider } from "./providers/yelp.ts"
import { mergeAndRankExternalHits, rosterNameKeys } from "./ranking.ts"
import { buildExternalSearchQuery, normalizeIssueCategoryForSearch } from "./trade_terms.ts"
import { resolveExternalVendorSearchContext } from "./search_location.ts"
import type {
  ExternalVendorProvider,
  ExternalVendorSearchInput,
  ExternalVendorSource,
  ExternalVendorSuggestion,
} from "./types.ts"

export type DiscoverExternalVendorsOptions = {
  issueCategory: string | null
  searchLocation: string
  /** Human label for admin UI (building · unit). */
  locationLabel?: string
  /** When set, exclude in-network roster names for this landlord. */
  landlordId?: string | null
  limit?: number
  /** Force mock provider even when live API keys exist. */
  forceMock?: boolean
}

export type DiscoverExternalVendorsResult = {
  suggestions: ExternalVendorSuggestion[]
  providersUsed: ExternalVendorSource[]
  mode: "live" | "mock"
  configured: boolean
  searchLocation: string
  locationLabel: string
  issueCategory: string | null
}

/** Resolve providers from Edge secrets / EXTERNAL_VENDOR_PROVIDER. */
export function resolveExternalVendorProviders(opts?: {
  forceMock?: boolean
}): ExternalVendorProvider[] {
  const mode = (Deno.env.get("EXTERNAL_VENDOR_PROVIDER") ?? "auto").trim().toLowerCase()
  const mock = new MockExternalVendorProvider()

  if (opts?.forceMock || mode === "mock") {
    return [mock]
  }

  const googleKey = Deno.env.get("GOOGLE_PLACES_API_KEY")?.trim() ?? ""
  const yelpKey = Deno.env.get("YELP_API_KEY")?.trim() ?? ""
  const netvendor = netVendorProviderFromEnv({ forceMock: opts?.forceMock })
  const providers: ExternalVendorProvider[] = []

  if (mode === "auto" || mode.includes("google")) {
    providers.push(new GooglePlacesExternalVendorProvider(googleKey))
  }
  if (mode === "auto" || mode.includes("yelp")) {
    providers.push(new YelpExternalVendorProvider(yelpKey))
  }
  if (mode === "auto" || mode.includes("netvendor")) {
    providers.push(netvendor)
  }

  const configuredLive = providers.some((p) => p.isConfigured() && p.id !== "mock")
  if (!configuredLive) {
    return [mock]
  }

  return providers.filter((p) => p.isConfigured())
}

async function loadRosterNamesForLandlord(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("vendors")
    .select("name")
    .eq("landlord_id", landlordId)
    .eq("active", true)
    .limit(500)

  if (error || !data) {
    console.warn("[external-vendor] roster load", error)
    return []
  }
  return data
    .map((r) => (typeof r.name === "string" ? r.name.trim() : ""))
    .filter(Boolean)
}

export async function discoverExternalVendors(
  supabase: SupabaseClient | null,
  options: DiscoverExternalVendorsOptions,
): Promise<DiscoverExternalVendorsResult> {
  const { tradeTerms, textQuery, searchLocation } = buildExternalSearchQuery(
    options.issueCategory,
    options.searchLocation,
  )
  const searchInput: ExternalVendorSearchInput = {
    issueCategory: options.issueCategory,
    searchLocation,
    tradeTerms,
    textQuery,
  }

  const providers = resolveExternalVendorProviders({
    forceMock: options.forceMock,
  })
  const providersUsed = providers.map((p) => p.id)
  const netvendorMockActive =
    providersUsed.includes("netvendor") &&
    (options.forceMock ||
      (Deno.env.get("NETVENDOR_USE_MOCK") ?? "").trim().toLowerCase() === "true" ||
      !Deno.env.get("NETVENDOR_API_KEY")?.trim() ||
      !Deno.env.get("NETVENDOR_API_BASE_URL")?.trim())
  const googleLive =
    Boolean(Deno.env.get("GOOGLE_PLACES_API_KEY")?.trim()) &&
    providersUsed.includes("google")
  const yelpLive =
    Boolean(Deno.env.get("YELP_API_KEY")?.trim()) && providersUsed.includes("yelp")
  const netvendorLive = providersUsed.includes("netvendor") && !netvendorMockActive
  const mode = googleLive || yelpLive || netvendorLive ? "live" : "mock"
  const configured = mode === "live"

  const hitGroups = await Promise.all(providers.map((p) => p.search(searchInput)))
  const hits = hitGroups.flat()

  let excludeNameKeys: Set<string> | undefined
  if (supabase && options.landlordId?.trim()) {
    const rosterNames = await loadRosterNamesForLandlord(
      supabase,
      options.landlordId.trim(),
    )
    excludeNameKeys = rosterNameKeys(rosterNames)
  }

  const suggestions = mergeAndRankExternalHits(hits, {
    limit: options.limit ?? 8,
    excludeNameKeys,
  })

  return {
    suggestions,
    providersUsed,
    mode,
    configured,
    searchLocation,
    locationLabel: options.locationLabel ?? searchLocation,
    issueCategory: options.issueCategory,
  }
}

/** Back-compat wrapper used by legacy import path. */
export type DiscoverExternalVendorsInput = {
  issueCategory: string | null
  searchLocation: string
  googleApiKey: string | null
  yelpApiKey: string | null
}

export async function discoverExternalVendorsMerged(
  input: DiscoverExternalVendorsInput,
): Promise<ExternalVendorSuggestion[]> {
  const { tradeTerms, textQuery, searchLocation } = buildExternalSearchQuery(
    input.issueCategory,
    input.searchLocation,
  )
  const searchInput: ExternalVendorSearchInput = {
    issueCategory: input.issueCategory,
    searchLocation,
    tradeTerms,
    textQuery,
  }

  const providers: ExternalVendorProvider[] = []
  const googleKey = input.googleApiKey?.trim() ?? ""
  const yelpKey = input.yelpApiKey?.trim() ?? ""
  if (googleKey) providers.push(new GooglePlacesExternalVendorProvider(googleKey))
  if (yelpKey) providers.push(new YelpExternalVendorProvider(yelpKey))
  if (providers.length === 0) providers.push(new MockExternalVendorProvider())

  const hitGroups = await Promise.all(providers.map((p) => p.search(searchInput)))
  return mergeAndRankExternalHits(hitGroups.flat(), { limit: 8 })
}

export async function discoverExternalVendorsForTicket(
  supabase: SupabaseClient,
  ticketId: string,
  opts?: { limit?: number; forceMock?: boolean },
): Promise<
  | (DiscoverExternalVendorsResult & { ticketId: string })
  | { error: string }
> {
  let issueCategory: string | null = null
  let unit = ""
  let building: string | null = null
  let landlordId: string | null = null

  const enriched = await supabase
    .from("maintenance_request_enriched")
    .select("id, issue_category, unit, landlord_id, building")
    .eq("id", ticketId)
    .maybeSingle()

  if (enriched.error) {
    console.warn("[external-vendor] enriched ticket load", enriched.error)
  }

  if (enriched.data) {
    issueCategory = enriched.data.issue_category == null
      ? null
      : String(enriched.data.issue_category)
    unit = enriched.data.unit == null ? "" : String(enriched.data.unit).trim()
    building = enriched.data.building == null ? null : String(enriched.data.building).trim()
    landlordId = enriched.data.landlord_id == null ? null : String(enriched.data.landlord_id)
  } else {
    const { data: ticket, error } = await supabase
      .from("maintenance_requests")
      .select("id, issue_category, unit, landlord_id")
      .eq("id", ticketId)
      .maybeSingle()

    if (error) {
      console.error("[external-vendor] load ticket", error)
      return { error: "Load ticket failed" }
    }
    if (!ticket) return { error: "Ticket not found" }

    issueCategory = ticket.issue_category == null
      ? null
      : String(ticket.issue_category)
    unit = ticket.unit == null ? "" : String(ticket.unit).trim()
    landlordId = ticket.landlord_id == null ? null : String(ticket.landlord_id)
  }

  const normalizedCategory = normalizeIssueCategoryForSearch(issueCategory)
  const { searchLocation, locationLabel } = await resolveExternalVendorSearchContext(
    supabase,
    { unit, building, landlordId },
  )

  const result = await discoverExternalVendors(supabase, {
    issueCategory: normalizedCategory,
    searchLocation,
    locationLabel,
    landlordId,
    limit: opts?.limit,
    forceMock: opts?.forceMock,
  })

  return { ticketId, ...result }
}
