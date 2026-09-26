/**
 * Look up a prior ticket for the same unit + trade to ground recurring follow-ups.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import type { SmsIntakeState } from "./residentIntakeTypes.ts"
import { resolveIntakeIssueCategory } from "./residentIntakeTypes.ts"
import { issueCategoryToVendorTrade } from "../vendor_trades.ts"

const LOOKBACK_DAYS = 180

export async function attachPriorRelatedTicket(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    unit: string
    intake: SmsIntakeState
    excludeTicketId?: string | null
  },
): Promise<SmsIntakeState> {
  if (params.intake.prior_related_ticket_id) return params.intake
  if (!params.intake.resident_reported_recurring) return params.intake

  const unit = params.unit.trim()
  if (!unit) return params.intake

  const category = issueCategoryToVendorTrade(resolveIntakeIssueCategory(params.intake))
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  let query = supabase
    .from("maintenance_requests")
    .select("id, issue_category, created_at, vendor_work_status")
    .eq("landlord_id", params.landlordId)
    .eq("unit", unit)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(8)

  if (params.excludeTicketId) {
    query = query.neq("id", params.excludeTicketId)
  }

  const { data, error } = await query
  if (error || !data?.length) {
    if (error) console.warn("[sms-intake] prior ticket lookup", error.message)
    return params.intake
  }

  const match = data.find((row) => {
    const cat = typeof row.issue_category === "string" ? row.issue_category.toLowerCase() : ""
    if (!category) return true
    if (cat === category.toLowerCase()) return true
    if (category.includes("pest") && cat.includes("pest")) return true
    return false
  })

  if (!match?.id) return params.intake
  return { ...params.intake, prior_related_ticket_id: String(match.id) }
}
