/**
 * Landlord quick-fix setting and the one approval line for a ticket.
 * Missing setting means tips stay on.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { selfFixApprovalLine } from "../../../../shared/maintenance/selfFixTips.ts"

export async function loadSuggestQuickFixes(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("landlord_onboarding")
    .select("account_settings")
    .eq("landlord_id", landlordId)
    .maybeSingle()
  if (error || !data) return true
  const account = (data.account_settings ?? {}) as {
    notifications?: { suggestQuickFixes?: boolean }
  }
  return account.notifications?.suggestQuickFixes !== false
}

export async function selfFixLineForTicket(
  supabase: SupabaseClient,
  landlordId: string,
  ticketId: string,
  fallbackIssue?: string | null,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("maintenance_requests")
    .select(
      "description, issue_headline, issue_category, resident_id, self_fix_tip, self_fix_result",
    )
    .eq("id", ticketId)
    .eq("landlord_id", landlordId)
    .maybeSingle()
  if (error || !data) return null
  const tipsEnabled = await loadSuggestQuickFixes(supabase, landlordId)
  const result = typeof data.self_fix_result === "string" ? data.self_fix_result : ""
  const tip = typeof data.self_fix_tip === "string" ? data.self_fix_tip : ""
  return selfFixApprovalLine({
    text: [data.issue_headline, data.description, fallbackIssue].filter(Boolean).join(" "),
    trade: typeof data.issue_category === "string" ? data.issue_category : null,
    hasTenant: Boolean(data.resident_id),
    tipsEnabled,
    diagnosticFacts: result
      ? { self_fix_result: result, self_fix_tip: tip, self_fix_tried: result === "not_fixed" ? tip : "" }
      : undefined,
  })
}
