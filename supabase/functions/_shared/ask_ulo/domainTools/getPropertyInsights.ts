/**
 * getPropertyInsights — domain tool wrapping propertyInsightsLookup.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  propertyInsightsLookup,
  type PropertyInsightTag,
  type PropertyInsightsResult,
} from "../propertyInsightsLookup.ts"

export type GetPropertyInsightsParams = {
  organizationId: string
  propertyId?: string | null
  insightTypes?: Array<
    "recurring_issues" | "needs_attention" | "vendor_response" | "preventive_repairs"
  >
  dateRangeDays?: number
}

export type GetPropertyInsightsResult = PropertyInsightsResult & {
  toolId: "get_property_insights"
  params: Record<string, unknown>
}

const TAG_MAP: Record<string, PropertyInsightTag> = {
  recurring_issues: "RECURRING ISSUES",
  needs_attention: "RISK",
  preventive_repairs: "PREVENT FUTURE REPAIRS",
  vendor_response: "VENDOR RESPONSE",
}

export async function getPropertyInsights(
  supabase: SupabaseClient,
  params: GetPropertyInsightsParams,
): Promise<GetPropertyInsightsResult> {
  const base = await propertyInsightsLookup(supabase, {
    landlordId: params.organizationId,
  })

  let insights = base.insights
  if (params.insightTypes?.length) {
    const allowed = new Set(
      params.insightTypes.map((t) => TAG_MAP[t]).filter(Boolean),
    )
    insights = insights.filter((i) => allowed.has(i.tag))
  }

  return {
    ...base,
    insights,
    found: insights.length > 0,
    toolId: "get_property_insights",
    params: {
      organizationId: params.organizationId,
      propertyId: params.propertyId ?? null,
      insightTypes: params.insightTypes ?? null,
      dateRangeDays: params.dateRangeDays ?? 60,
      resultCount: insights.length,
    },
  }
}
