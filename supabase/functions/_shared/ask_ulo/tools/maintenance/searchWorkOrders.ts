/**
 * searchWorkOrders — first live domain tool.
 * Wraps searchOperationalRecords with a clearer parameterized surface.
 * Prefer `searchWorkOrdersAsToolResult` when callers want the shared ToolResult contract.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  toolFail,
  toolOk,
  type EvidenceItem,
  type ToolResult,
} from "../_shared/toolResult.ts"
import {
  searchOperationalRecords,
  type OperationalWorkOrder,
  type SearchOperationalRecordsResult,
} from "./searchOperationalRecords.ts"

export type SearchWorkOrdersParams = {
  /** Landlord / organization id (required). */
  organizationId: string
  propertyId?: string | null
  unitId?: string | null
  buildingFilter?: string | null
  unitLabel?: string | null
  category?: string | null
  /** Free-text / synonym terms. */
  searchTerms?: string[]
  /** Workflow or vendor_work_status filter hint. */
  status?: string | null
  query?: string | null
  /** Lookback window in days (default 120). */
  dateRangeDays?: number
  /** Include completed / closed tickets when true (hint for callers). */
  includeCompleted?: boolean
  approvalRequired?: boolean
  slaExpired?: boolean
  sortBy?: "created_at" | "days_open" | "priority"
  sortOrder?: "asc" | "desc"
  limit?: number
}

export type SearchWorkOrdersResult = SearchOperationalRecordsResult & {
  toolId: "search_work_orders"
  params: Record<string, unknown>
}

function sortWorkOrders(
  rows: OperationalWorkOrder[],
  sortBy: SearchWorkOrdersParams["sortBy"],
  sortOrder: "asc" | "desc",
): OperationalWorkOrder[] {
  const dir = sortOrder === "asc" ? 1 : -1
  const copy = [...rows]
  copy.sort((a, b) => {
    if (sortBy === "days_open") return (a.daysOpen - b.daysOpen) * dir
    if (sortBy === "priority") {
      const rank = (p: string | null) => {
        const v = (p ?? "").toLowerCase()
        if (v.includes("critical") || v.includes("emergency")) return 0
        if (v.includes("urgent") || v.includes("high")) return 1
        if (v.includes("medium") || v.includes("normal")) return 2
        return 3
      }
      return (rank(a.priority) - rank(b.priority)) * dir
    }
    return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * dir
  })
  return copy
}

/**
 * Search work orders for a landlord with optional filters.
 * Organization scope is always enforced via organizationId → landlord_id.
 */
export async function searchWorkOrders(
  supabase: SupabaseClient,
  params: SearchWorkOrdersParams,
): Promise<SearchWorkOrdersResult> {
  const base = await searchOperationalRecords(supabase, {
    organizationId: params.organizationId,
    propertyId: params.propertyId,
    unitId: params.unitId,
    buildingFilter: params.buildingFilter,
    unitLabel: params.unitLabel,
    category: params.category,
    searchTerms: params.searchTerms,
    status: params.status,
    query: params.query,
    dateRangeDays: params.dateRangeDays,
    limit: params.limit,
  })

  let workOrders = base.workOrders
  if (params.approvalRequired) {
    workOrders = workOrders.filter((w) => w.approvalStatus === "review_required")
  }
  if (params.slaExpired) {
    workOrders = workOrders.filter((w) => w.slaExpired)
  }

  const sortBy = params.sortBy ?? "created_at"
  const sortOrder = params.sortOrder ?? "desc"
  workOrders = sortWorkOrders(workOrders, sortBy, sortOrder)

  if (params.limit != null && workOrders.length > params.limit) {
    workOrders = workOrders.slice(0, params.limit)
  }

  return {
    ...base,
    workOrders,
    toolId: "search_work_orders",
    params: {
      organizationId: params.organizationId,
      propertyId: params.propertyId ?? null,
      unitId: params.unitId ?? null,
      buildingFilter: params.buildingFilter ?? null,
      category: params.category ?? null,
      status: params.status ?? null,
      approvalRequired: params.approvalRequired ?? false,
      slaExpired: params.slaExpired ?? false,
      includeCompleted: params.includeCompleted ?? false,
      dateRangeDays: params.dateRangeDays ?? 120,
      sortBy,
      sortOrder,
      limit: params.limit ?? null,
      recordCount: workOrders.length,
    },
  }
}

function workOrdersToEvidence(rows: OperationalWorkOrder[]): EvidenceItem[] {
  return rows.slice(0, 12).map((w) => ({
    id: w.workOrderId,
    source: "maintenance_requests+workflow_runs",
    label: w.title || w.category || w.workOrderId,
    excerpt: [
      w.propertyName,
      w.unitLabel ? `Unit ${w.unitLabel}` : null,
      w.category,
      w.daysOpen > 0 ? `${w.daysOpen}d open` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    entityIds: {
      maintenance_request_id: w.maintenanceRequestId,
      workflow_run_id: w.workflowRunId,
      property_name: w.propertyName,
      unit: w.unitLabel,
    },
  }))
}

/** Adapt legacy SearchWorkOrdersResult → ToolResult (shared contract). */
export function toSearchWorkOrdersToolResult(
  result: SearchWorkOrdersResult,
): ToolResult<SearchWorkOrdersResult> {
  if (!result.available && result.error) {
    return toolFail(result.error, workOrdersToEvidence(result.workOrders ?? []))
  }
  return toolOk(result, workOrdersToEvidence(result.workOrders ?? []))
}

/** Same as searchWorkOrders, returning the shared ToolResult envelope. */
export async function searchWorkOrdersAsToolResult(
  supabase: SupabaseClient,
  params: SearchWorkOrdersParams,
): Promise<ToolResult<SearchWorkOrdersResult>> {
  try {
    const result = await searchWorkOrders(supabase, params)
    return toSearchWorkOrdersToolResult(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return toolFail(message)
  }
}
