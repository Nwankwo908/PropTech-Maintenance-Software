/**
 * rankVendors — one parameterized tool for vendor metrics.
 * Replaces separate playbooks for best / fastest / inactive / overload / completion.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { AskUloCitation } from "../opsGraphLookup.ts"
import { vendorBestLookup } from "../vendorBestLookup.ts"
import { vendorResponseSpeedLookup } from "../vendorResponseSpeedLookup.ts"
import { vendorCompletionLookup } from "../vendorCompletionLookup.ts"
import { vendorInactiveLookup } from "../vendorInactiveLookup.ts"
import { vendorOverloadLookup } from "../vendorOverloadLookup.ts"

export type RankVendorsMetric =
  | "response_time"
  | "response_rate"
  | "acceptance_rate"
  | "completion_rate"
  | "completed_jobs"
  | "active_jobs"
  | "decline_rate"
  | "overall_quality"
  | "inactive"
  | "workload"

export type RankVendorsParams = {
  organizationId: string
  propertyId?: string | null
  buildingFilter?: string | null
  trade?: string | null
  metric: RankVendorsMetric
  order?: "asc" | "desc"
  pendingJobsOnly?: boolean
  activeOnly?: boolean
  minimumJobCount?: number
  dateRangeDays?: number
  limit?: number
  /** Original question — used for trade / fastest|slowest framing. */
  question?: string
}

export type RankVendorsResult = {
  toolId: "rank_vendors"
  available: boolean
  found: boolean
  metric: RankVendorsMetric
  bullets: string[]
  citations: AskUloCitation[]
  markdown: string
  ranked: Array<Record<string, unknown>>
  params: Record<string, unknown>
}

function mapMetricFromHints(metric: RankVendorsMetric): RankVendorsMetric {
  if (metric === "response_rate" || metric === "acceptance_rate") return "response_time"
  if (metric === "completed_jobs") return "completion_rate"
  if (metric === "active_jobs" || metric === "decline_rate") return "workload"
  return metric
}

export async function rankVendors(
  supabase: SupabaseClient,
  params: RankVendorsParams,
): Promise<RankVendorsResult> {
  const metric = mapMetricFromHints(params.metric)
  const question = params.question ?? ""
  const landlordId = params.organizationId

  let available = false
  let found = false
  let bullets: string[] = []
  let citations: AskUloCitation[] = []
  let markdown = ""
  let ranked: Array<Record<string, unknown>> = []

  if (metric === "response_time") {
    const r = await vendorResponseSpeedLookup(supabase, { landlordId, question })
    available = r.available
    found = r.found
    bullets = r.bullets
    citations = r.citations
    markdown = r.markdown
    ranked = r.ranked as unknown as Array<Record<string, unknown>>
  } else if (metric === "completion_rate") {
    const r = await vendorCompletionLookup(supabase, { landlordId })
    available = r.available
    found = r.found
    bullets = r.bullets
    citations = r.citations
    markdown = r.markdown
    ranked = r.ranked as unknown as Array<Record<string, unknown>>
  } else if (metric === "inactive") {
    const r = await vendorInactiveLookup(supabase, { landlordId })
    available = r.available
    found = r.found
    bullets = r.bullets
    citations = r.citations
    markdown = r.markdown
    ranked = r.ranked as unknown as Array<Record<string, unknown>>
  } else if (metric === "workload") {
    const r = await vendorOverloadLookup(supabase, { landlordId })
    available = r.available
    found = r.found
    bullets = r.bullets
    citations = r.citations
    markdown = r.markdown
    ranked = r.ranked as unknown as Array<Record<string, unknown>>
  } else {
    const r = await vendorBestLookup(supabase, {
      landlordId,
      question: question || `best ${params.trade ?? "vendor"}`,
      buildingFilter: params.buildingFilter,
    })
    available = r.available
    found = r.found
    bullets = r.bullets
    citations = r.citations
    markdown = r.markdown
    ranked = r.ranked as unknown as Array<Record<string, unknown>>
  }

  if (params.limit != null && ranked.length > params.limit) {
    ranked = ranked.slice(0, params.limit)
  }

  return {
    toolId: "rank_vendors",
    available,
    found,
    metric,
    bullets,
    citations,
    markdown,
    ranked,
    params: {
      organizationId: params.organizationId,
      metric,
      order: params.order ?? "desc",
      trade: params.trade ?? null,
      pendingJobsOnly: params.pendingJobsOnly ?? false,
      limit: params.limit ?? null,
      resultCount: ranked.length,
    },
  }
}
