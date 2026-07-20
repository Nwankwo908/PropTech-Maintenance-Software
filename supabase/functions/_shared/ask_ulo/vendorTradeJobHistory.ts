/**
 * Job-history by trade for Ask Ulo vendor ranking.
 * Vendors stored as generalists (null category) still count when they completed
 * work in the asked trade (e.g. Summit HVAC on an HVAC ticket).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  issueCategoryToVendorTrade,
  type VendorTradeSlug,
} from "../vendor_trades.ts"

const OPEN_STATUSES = new Set(["pending_accept", "accepted", "in_progress"])

export type VendorTradeJobHistory = {
  vendorId: string
  completedJobs: number
  openJobs: number
  /** Example unit/building labels from matching tickets (for evidence). */
  sampleLocations: string[]
}

export function issueMatchesTrade(
  issueCategory: string | null | undefined,
  tradeSlug: VendorTradeSlug,
): boolean {
  const issueTrade = issueCategoryToVendorTrade(issueCategory)
  return issueTrade === tradeSlug
}

/** Pure merge helper — used by lookup + tests. */
export function aggregateTradeJobs(
  rows: Array<{
    assigned_vendor_id?: string | null
    vendor_work_status?: string | null
    unit?: string | null
    issue_category?: string | null
  }>,
  tradeSlug: VendorTradeSlug,
): Map<string, VendorTradeJobHistory> {
  const byId = new Map<string, VendorTradeJobHistory>()

  for (const row of rows) {
    const vendorId = typeof row.assigned_vendor_id === "string" ? row.assigned_vendor_id : null
    if (!vendorId) continue
    if (!issueMatchesTrade(row.issue_category, tradeSlug)) continue

    let entry = byId.get(vendorId)
    if (!entry) {
      entry = { vendorId, completedJobs: 0, openJobs: 0, sampleLocations: [] }
      byId.set(vendorId, entry)
    }

    const status = String(row.vendor_work_status ?? "").trim().toLowerCase()
    if (status === "completed") entry.completedJobs += 1
    else if (OPEN_STATUSES.has(status)) entry.openJobs += 1

    const unit = typeof row.unit === "string" ? row.unit.trim() : ""
    if (unit && entry.sampleLocations.length < 3 && !entry.sampleLocations.includes(unit)) {
      entry.sampleLocations.push(unit)
    }
  }

  return byId
}

export async function loadVendorTradeJobHistory(
  supabase: SupabaseClient,
  input: { landlordId: string; tradeSlug: VendorTradeSlug },
): Promise<Map<string, VendorTradeJobHistory>> {
  const landlordId = input.landlordId.trim()
  if (!landlordId) return new Map()

  const { data, error } = await supabase
    .from("maintenance_requests")
    .select("assigned_vendor_id, vendor_work_status, unit, issue_category")
    .eq("landlord_id", landlordId)
    .not("assigned_vendor_id", "is", null)
    .limit(800)

  if (error) {
    console.error("[ask_ulo/vendorTradeJobHistory]", error.message)
    return new Map()
  }

  return aggregateTradeJobs(
    (data ?? []) as Array<{
      assigned_vendor_id?: string | null
      vendor_work_status?: string | null
      unit?: string | null
      issue_category?: string | null
    }>,
    input.tradeSlug,
  )
}
