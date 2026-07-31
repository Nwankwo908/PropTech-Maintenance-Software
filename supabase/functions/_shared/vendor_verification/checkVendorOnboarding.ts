/**
 * Scheduled vendor onboarding reminders + landlord escalation via the workflow engine.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { runWorkflowEscalations } from "../engine/runWorkflowEscalations.ts"

export type CheckVendorOnboardingSummary = {
  landlord_id: string | null
  candidates: number
  escalated: number
  skipped: number
  reminders: number
  landlord_escalations: number
  escalations: Array<{
    workflow_run_id: string
    template_id: string
    reason: string
    notified: string[]
    notify_errors: string[]
  }>
  errors: Array<{ workflow_run_id: string; error: string }>
}

/**
 * Run the vendor_onboarding slice of run-workflow-escalations (same engine path).
 */
export async function checkVendorOnboarding(
  supabase: SupabaseClient,
  landlordId: string | null,
): Promise<CheckVendorOnboardingSummary> {
  const lid = landlordId?.trim()
  if (!lid) {
    return {
      landlord_id: null,
      candidates: 0,
      escalated: 0,
      skipped: 0,
      reminders: 0,
      landlord_escalations: 0,
      escalations: [],
      errors: [],
    }
  }

  const result = await runWorkflowEscalations(supabase, { landlordId: lid })
  const vendorEscalations = result.escalations.filter(
    (row) => row.template_id === "vendor_onboarding",
  )

  let reminders = 0
  let landlordEscalations = 0
  for (const row of vendorEscalations) {
    if (row.reason === "reminder_due") reminders += 1
    else landlordEscalations += 1
  }

  return {
    landlord_id: lid,
    candidates: vendorEscalations.length,
    escalated: vendorEscalations.length,
    skipped: result.skipped,
    reminders,
    landlord_escalations: landlordEscalations,
    escalations: vendorEscalations,
    errors: result.errors,
  }
}
