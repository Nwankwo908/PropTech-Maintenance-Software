/**
 * searchLegalSources — domain tool wrapping legal RAG + structured compliance.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  legalRagSearch,
  type LegalRagSearchResult,
} from "../../retrieval/searchExternalSources.ts"
import {
  structuredComplianceLookup,
  type StructuredLookupResult,
} from "../../retrieval/structuredLookup.ts"

export type SearchLegalSourcesParams = {
  question: string
  stateCode?: string | null
  citySlug?: string | null
  countySlug?: string | null
  countryCode?: string | null
  housingProgram?: string | null
  /** Default true. Set false for structured-only (non-legal intents). */
  includeRag?: boolean
  /** Default true. */
  includeStructured?: boolean
  matchCount?: number
}

export type SearchLegalSourcesResult = {
  toolId: "search_legal_sources"
  legal: LegalRagSearchResult | null
  structured: StructuredLookupResult | null
  params: Record<string, unknown>
}

export async function searchLegalSources(
  supabase: SupabaseClient,
  params: SearchLegalSourcesParams,
): Promise<SearchLegalSourcesResult> {
  const includeRag = params.includeRag !== false
  const includeStructured = params.includeStructured !== false

  const [legal, structured] = await Promise.all([
    includeRag
      ? legalRagSearch(supabase, {
          question: params.question,
          stateCode: params.stateCode,
          citySlug: params.citySlug,
          countySlug: params.countySlug,
          countryCode: params.countryCode,
          housingProgram: params.housingProgram,
          matchCount: params.matchCount,
        })
      : Promise.resolve(null),
    includeStructured
      ? structuredComplianceLookup(supabase, {
          question: params.question,
          stateCode: params.stateCode,
          citySlug: params.citySlug,
          countySlug: params.countySlug,
        })
      : Promise.resolve(null),
  ])

  return {
    toolId: "search_legal_sources",
    legal,
    structured,
    params: {
      stateCode: params.stateCode ?? null,
      citySlug: params.citySlug ?? null,
      countySlug: params.countySlug ?? null,
      countryCode: params.countryCode ?? null,
      housingProgram: params.housingProgram ?? null,
      includeRag,
      includeStructured,
      legalHitCount: legal?.hits.length ?? 0,
      structuredFactCount: structured?.facts.length ?? 0,
      legalMode: legal?.mode ?? null,
      structuredRelevant: structured?.relevant ?? false,
    },
  }
}
