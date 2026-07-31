/**
 * rankProperties — domain tool wrapping propertyRankingLookup.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  propertyRankingLookup,
  type PropertyRankingResult,
} from "./propertyRankingLookup.ts"

export type RankPropertiesParams = {
  organizationId: string
  propertyId?: string | null
  limit?: number
}

export type RankPropertiesResult = PropertyRankingResult & {
  toolId: "rank_properties"
  params: Record<string, unknown>
}

export async function rankProperties(
  supabase: SupabaseClient,
  params: RankPropertiesParams,
): Promise<RankPropertiesResult> {
  const base = await propertyRankingLookup(supabase, {
    landlordId: params.organizationId,
  })

  let ranked = base.ranked
  if (params.limit != null && params.limit > 0) {
    ranked = ranked.slice(0, params.limit)
  }

  return {
    ...base,
    ranked,
    top: ranked[0] ?? base.top,
    toolId: "rank_properties",
    params: {
      organizationId: params.organizationId,
      propertyId: params.propertyId ?? null,
      limit: params.limit ?? null,
      resultCount: ranked.length,
      canRank: base.canRank,
    },
  }
}
