/**
 * searchOperationsGraph — domain tool wrapping opsGraphLookup.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  opsGraphLookup,
  type OpsGraphLookupResult,
} from "../../retrieval/searchInternalData.ts"

export type SearchOperationsGraphParams = {
  organizationId: string
  propertyId?: string | null
  buildingFilter?: string | null
  eventLimit?: number
  query?: string | null
}

export type SearchOperationsGraphResult = OpsGraphLookupResult & {
  toolId: "search_operations_graph"
  available: boolean
  found: boolean
  markdown: string
  params: Record<string, unknown>
}

function formatOpsMarkdown(r: OpsGraphLookupResult): string {
  if (!r.bullets.length) {
    return [
      "## Operations activity",
      "",
      "No recent open tickets or workflow activity matched this scope.",
    ].join("\n")
  }
  return ["## Operations activity", "", ...r.bullets.map((b) => `- ${b}`)].join(
    "\n",
  )
}

export async function searchOperationsGraph(
  supabase: SupabaseClient,
  params: SearchOperationsGraphParams,
): Promise<SearchOperationsGraphResult> {
  const base = await opsGraphLookup(supabase, {
    landlordId: params.organizationId,
    buildingFilter: params.buildingFilter ?? params.propertyId,
    eventLimit: params.eventLimit,
  })

  const found =
    base.bullets.length > 0 ||
    base.openTicketCount > 0 ||
    base.openWorkflowCount > 0

  return {
    ...base,
    toolId: "search_operations_graph",
    available: true,
    found,
    markdown: formatOpsMarkdown(base),
    params: {
      organizationId: params.organizationId,
      propertyId: params.propertyId ?? null,
      buildingFilter: params.buildingFilter ?? null,
      eventLimit: params.eventLimit ?? 25,
      query: params.query ?? null,
      openTicketCount: base.openTicketCount,
      openWorkflowCount: base.openWorkflowCount,
      recentEventCount: base.recentEventCount,
    },
  }
}
