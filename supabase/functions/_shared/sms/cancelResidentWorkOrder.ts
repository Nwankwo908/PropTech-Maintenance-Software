/**
 * Resident SMS cancel — delegates to central terminateWorkOrder.
 *
 * Ticket soft-close + Active Tasks runs + vendor notify all live in
 * terminateWorkOrder. This module keeps the historical export name and
 * intake-pin helpers used by inboundInterpretationAct.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { terminateWorkOrder } from "../terminateWorkOrder.ts"
import type { SmsIntakeState } from "./residentIntakeTypes.ts"

export { runLinksCancelledTicket } from "./cancelResidentWorkOrderLink.ts"

export async function closeWorkOrderCancelledByResident(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    conversationId?: string | null
    residentId?: string | null
    intake?: SmsIntakeState | null
    descriptionNote?: string
    lastResidentMessage?: string | null
    /** When false, terminate still closes but skips vendor SMS/email. */
    notifyVendor?: boolean
  },
): Promise<{ ok: boolean; alreadyClosed?: boolean; error?: string; vendorNotify?: string }> {
  const result = await terminateWorkOrder(supabase, {
    landlordId: params.landlordId,
    ticketId: params.ticketId,
    mode: "cancel",
    source: "resident_sms",
    actorType: "resident",
    actorId: params.residentId ?? null,
    reason: "Cancelled by the resident over text",
    conversationId: params.conversationId,
    residentId: params.residentId,
    intake: params.intake,
    lastResidentMessage: params.lastResidentMessage,
    descriptionNote: params.descriptionNote,
    notifyVendor: params.notifyVendor !== false,
    closeWorkflowRuns: true,
  })

  if (!result.ok) {
    return { ok: false, error: result.error }
  }

  return {
    ok: true,
    alreadyClosed: result.alreadyTerminated === true,
    vendorNotify: result.vendorNotify,
  }
}
