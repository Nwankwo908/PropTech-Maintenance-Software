import {
  ALPHA_PRODUCTION_LANDLORD_ID,
  DEMO_SHOWCASE_LANDLORD_ID,
} from "../demo_workflow_ids.ts"
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  isDemoExternalVendorName,
  isDemoExternalVendorProviderRef,
} from "../../../../shared/externalVendor/demoVendorNames.ts"
import { MockExternalVendorProvider } from "./providers/mock.ts"
import { thumbtackProviderFromEnv } from "./providers/thumbtack.ts"
import { mergeAndRankExternalHits, rosterNameKeys } from "./ranking.ts"
import { buildExternalSearchQuery, normalizeIssueCategoryForSearch } from "./trade_terms.ts"
import { resolveExternalVendorSearchContext } from "./search_location.ts"
import type {
  ExternalVendorProvider,
  ExternalVendorSearchInput,
  ExternalVendorSource,
  ExternalVendorSuggestion,
} from "./types.ts"
import { landlordHasVendorMarketplace } from "../../../../shared/landlordCapabilities.ts"

export type DiscoverExternalVendorsOptions = {
  issueCategory: string | null
  searchLocation: string
  /** Human label for admin UI (building · unit). */
  locationLabel?: string
  areaLabel?: string | null
  /** When set, exclude in-network roster names for this landlord. */
  landlordId?: string | null
  limit?: number
  /** Force mock provider even when live API keys exist. Ignored unless allowMock. */
  forceMock?: boolean
  /** Demo/showcase accounts only. Alpha never receives mock vendors. */
  allowMock?: boolean
}

export type DiscoverExternalVendorsResult = {
  suggestions: ExternalVendorSuggestion[]
  providersUsed: ExternalVendorSource[]
  mode: "live" | "mock"
  configured: boolean
  searchLocation: string
  locationLabel: string
  areaLabel: string | null
  issueCategory: string | null
}

/** Resolve providers from Edge secrets / EXTERNAL_VENDOR_PROVIDER. */
export function resolveExternalVendorProviders(opts?: {
  forceMock?: boolean
  allowMock?: boolean
}): ExternalVendorProvider[] {
  const allowMock = opts?.allowMock === true
  const mode = (Deno.env.get("EXTERNAL_VENDOR_PROVIDER") ?? "auto").trim().toLowerCase()
  const mock = new MockExternalVendorProvider()
  const forceMock = allowMock && (opts?.forceMock === true || mode === "mock")

  if (forceMock) {
    return [mock]
  }

  const thumbtack = thumbtackProviderFromEnv()
  const providers: ExternalVendorProvider[] = []

  if (mode === "auto" || mode.includes("thumbtack")) {
    providers.push(thumbtack)
  }

  const live = providers.filter((p) => p.isConfigured() && p.id !== "mock")
  if (live.length > 0) return live
  return allowMock ? [mock] : []
}

export async function landlordAllowsMockExternalVendors(
  _supabase: SupabaseClient | null,
  landlordId: string | null | undefined,
): Promise<boolean> {
  const id = landlordId?.trim() ?? ""
  if (!id || id === ALPHA_PRODUCTION_LANDLORD_ID) return false
  return id === DEMO_SHOWCASE_LANDLORD_ID
}

function isLiveExternalVendorHit(hit: {
  name: string
  source: ExternalVendorSource
  providerRef?: string | null
}): boolean {
  if (hit.source === "mock") return false
  if (isDemoExternalVendorName(hit.name)) return false
  if (isDemoExternalVendorProviderRef(hit.providerRef)) return false
  return true
}

function isLiveExternalVendorSuggestion(row: {
  name: string
  sources: ExternalVendorSource[]
}): boolean {
  if (!row.sources.some((src) => src !== "mock")) return false
  if (isDemoExternalVendorName(row.name)) return false
  return true
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

  const landlordAllows = await landlordAllowsMockExternalVendors(
    supabase,
    options.landlordId,
  )
  const allowMock = landlordAllows && options.allowMock !== false

  const providers = resolveExternalVendorProviders({
    forceMock: allowMock && options.forceMock === true,
    allowMock,
  })
  const providersUsed = allowMock
    ? providers.map((p) => p.id)
    : providers.map((p) => p.id).filter((id) => id !== "mock")
  const thumbtackLive =
    Boolean(Deno.env.get("THUMBTACK_CLIENT_ID")?.trim()) &&
    Boolean(Deno.env.get("THUMBTACK_CLIENT_SECRET")?.trim()) &&
    providersUsed.includes("thumbtack")
  const mode = thumbtackLive ? "live" : "mock"
  const configured = mode === "live"

  const hitGroups = await Promise.all(providers.map((p) => p.search(searchInput)))
  const hits = allowMock
    ? hitGroups.flat()
    : hitGroups.flat().filter(isLiveExternalVendorHit)

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
  }).filter((row) => allowMock || isLiveExternalVendorSuggestion(row))

  return {
    suggestions,
    providersUsed,
    mode: configured ? "live" : allowMock ? "mock" : "live",
    configured,
    searchLocation,
    locationLabel: options.locationLabel ?? searchLocation,
    areaLabel: options.areaLabel ?? null,
    issueCategory: options.issueCategory,
  }
}

/** Back-compat wrapper used by legacy import path. */
export type DiscoverExternalVendorsInput = {
  issueCategory: string | null
  searchLocation: string
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

  const providers: ExternalVendorProvider[] = [new MockExternalVendorProvider()]

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

  const fromWorkflow = await loadWorkflowLocationForTicket(supabase, ticketId)
  if (fromWorkflow.unit) unit = fromWorkflow.unit
  if (fromWorkflow.building) building = fromWorkflow.building

  const normalizedCategory = normalizeIssueCategoryForSearch(issueCategory)
  const { searchLocation, locationLabel, areaLabel } = await resolveExternalVendorSearchContext(
    supabase,
    { unit, building, landlordId },
  )

  const allowMock = await landlordAllowsMockExternalVendors(supabase, landlordId)
  if (!landlordHasVendorMarketplace(landlordId)) {
    return {
      ticketId,
      suggestions: [],
      providersUsed: [],
      mode: "live" as const,
      configured: true,
      searchLocation,
      locationLabel,
      areaLabel,
      issueCategory: normalizedCategory,
    }
  }
  const result = await discoverExternalVendors(supabase, {
    issueCategory: normalizedCategory,
    searchLocation,
    locationLabel,
    areaLabel,
    landlordId,
    limit: opts?.limit,
    forceMock: allowMock && opts?.forceMock === true,
    allowMock,
  })

  return { ticketId, ...result }
}

function metaTrimmedString(meta: unknown, key: string): string | null {
  if (!meta || typeof meta !== "object") return null
  const value = (meta as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/** Prefer the work-order unit (workflow unit_id / building) over a label-only Unit A match. */
export function workflowLocationHintFromRuns(
  runs: Array<{
    unit_id?: string | null
    metadata?: unknown
  }>,
): { unitId: string | null; building: string | null; unitLabel: string | null } {
  for (const run of runs) {
    const unitId = typeof run.unit_id === "string" && run.unit_id.trim()
      ? run.unit_id.trim()
      : null
    const building = metaTrimmedString(run.metadata, "building")
    const unitLabel = metaTrimmedString(run.metadata, "unit_label")
    if (unitId || building) return { unitId, building, unitLabel }
  }
  return { unitId: null, building: null, unitLabel: null }
}

async function loadWorkflowLocationForTicket(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<{ unit: string | null; building: string | null }> {
  const select = "unit_id, metadata, updated_at"
  const queries = [
    supabase.from("workflow_runs").select(select).eq("entity_id", ticketId)
      .order("updated_at", { ascending: false }).limit(8),
    supabase.from("workflow_runs").select(select).eq("metadata->>draft_ticket_id", ticketId)
      .order("updated_at", { ascending: false }).limit(8),
    supabase.from("workflow_runs").select(select).eq("metadata->>maintenance_request_id", ticketId)
      .order("updated_at", { ascending: false }).limit(8),
  ]

  const runs: Array<{ unit_id?: string | null; metadata?: unknown }> = []
  const seen = new Set<string>()
  for (const query of queries) {
    const { data, error } = await query
    if (error) {
      console.warn("[external-vendor] workflow location load", error)
      continue
    }
    for (const row of data ?? []) {
      const key = JSON.stringify(row)
      if (seen.has(key)) continue
      seen.add(key)
      runs.push(row)
    }
  }

  const hint = workflowLocationHintFromRuns(runs)
  if (hint.unitId) {
    const { data: unitRow } = await supabase
      .from("units")
      .select("unit_label, building")
      .eq("id", hint.unitId)
      .maybeSingle()
    if (unitRow) {
      return {
        unit: typeof unitRow.unit_label === "string" ? unitRow.unit_label.trim() : hint.unitLabel,
        building: typeof unitRow.building === "string" && unitRow.building.trim()
          ? unitRow.building.trim()
          : hint.building,
      }
    }
  }

  return { unit: hint.unitLabel, building: hint.building }
}
