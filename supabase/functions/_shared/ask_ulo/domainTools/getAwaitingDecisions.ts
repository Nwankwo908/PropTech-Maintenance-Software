/**
 * getAwaitingDecisions — domain tool wrapping repairsToApproveLookup.
 * Covers Needs Your Attention / repair approvals / escalated maintenance holds.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  repairsToApproveLookup,
  type RepairsToApproveResult,
} from "../repairsToApproveLookup.ts"

export type GetAwaitingDecisionsParams = {
  organizationId: string
  propertyId?: string | null
  decisionTypes?: Array<"repair_approval" | "sla_expired" | "vendor_declined" | "escalated">
  priorities?: string[]
  maintenanceOnly?: boolean
  limit?: number
}

export type GetAwaitingDecisionsResult = RepairsToApproveResult & {
  toolId: "get_awaiting_decisions"
  params: Record<string, unknown>
}

export async function getAwaitingDecisions(
  supabase: SupabaseClient,
  params: GetAwaitingDecisionsParams,
): Promise<GetAwaitingDecisionsResult> {
  const base = await repairsToApproveLookup(supabase, {
    landlordId: params.organizationId,
  })

  let items = base.items
  if (params.priorities?.length) {
    const wanted = new Set(params.priorities.map((p) => p.toLowerCase()))
    items = items.filter((i) => {
      if (!i.priority) return true
      return wanted.has(i.priority.toLowerCase())
    })
  }
  if (params.limit != null && items.length > params.limit) {
    items = items.slice(0, params.limit)
  }

  return {
    ...base,
    items,
    found: items.length > 0,
    toolId: "get_awaiting_decisions",
    params: {
      organizationId: params.organizationId,
      propertyId: params.propertyId ?? null,
      decisionTypes: params.decisionTypes ?? null,
      priorities: params.priorities ?? null,
      maintenanceOnly: params.maintenanceOnly ?? true,
      limit: params.limit ?? null,
      resultCount: items.length,
    },
  }
}
