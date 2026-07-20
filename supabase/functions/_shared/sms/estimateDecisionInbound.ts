/**
 * Landlord / ops reply APPROVE or DECLINE on an estimate notify thread
 * (or any conversation awaiting an estimate decision).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { decideMaintenanceEstimate } from "../maintenanceEstimates.ts"

export type EstimateDecisionKeyword = "approve" | "reject"

export function parseEstimateDecisionKeyword(
  body: string,
): EstimateDecisionKeyword | null {
  const normalized = body
    .trim()
    .toUpperCase()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")

  if (!normalized) return null

  if (
    normalized === "APPROVE" ||
    normalized === "APPROVED" ||
    normalized === "YES APPROVE" ||
    normalized === "APPROVE ESTIMATE"
  ) {
    return "approve"
  }

  if (
    normalized === "DECLINE" ||
    normalized === "DECLINED" ||
    normalized === "REJECT" ||
    normalized === "REJECTED" ||
    normalized === "NO DECLINE" ||
    normalized === "DECLINE ESTIMATE"
  ) {
    return "reject"
  }

  return null
}

type AwaitingEstimateDecision = {
  estimateId: string
  actionToken?: string | null
  ticketId?: string | null
}

function readAwaitingEstimateDecision(
  intakeState: unknown,
): AwaitingEstimateDecision | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>).awaiting_estimate_decision
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const estimateId =
    (typeof row.estimate_id === "string" && row.estimate_id.trim()) ||
    (typeof row.estimateId === "string" && row.estimateId.trim()) ||
    ""
  if (!estimateId) return null
  const actionToken =
    (typeof row.action_token === "string" && row.action_token.trim()) ||
    (typeof row.actionToken === "string" && row.actionToken.trim()) ||
    null
  const ticketId =
    (typeof row.ticket_id === "string" && row.ticket_id.trim()) ||
    (typeof row.ticketId === "string" && row.ticketId.trim()) ||
    null
  return { estimateId, actionToken, ticketId }
}

async function clearAwaitingEstimateDecision(
  supabase: SupabaseClient,
  conversationId: string,
  priorIntake: Record<string, unknown>,
): Promise<void> {
  const next = { ...priorIntake }
  delete next.awaiting_estimate_decision
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
}

export async function tryHandleEstimateDecisionInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string
    body: string
    identityType: string
  },
): Promise<
  | {
      handled: true
      action: EstimateDecisionKeyword
      estimateId: string
      status: "approved" | "rejected"
      already?: boolean
      replyBody: string
    }
  | { handled: false }
> {
  const action = parseEstimateDecisionKeyword(params.body)
  if (!action) return { handled: false }

  // Only landlord / ops notify threads may approve by text — never vendor/resident.
  if (
    params.identityType === "vendor" ||
    params.identityType === "resident"
  ) {
    return { handled: false }
  }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("id, intake_state, maintenance_request_id, conversation_type")
    .eq("id", params.conversationId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()

  if (!conv?.id) return { handled: false }

  const isLandlordThread =
    conv.conversation_type === "landlord_update" ||
    params.identityType === "landlord"

  if (!isLandlordThread) {
    return { handled: false }
  }

  const priorIntake =
    conv.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}
  let awaiting = readAwaitingEstimateDecision(priorIntake)

  // Allow landlord / ops threads to approve by keyword when a pending estimate
  // is linked to this conversation's work order.
  if (!awaiting) {
    const ticketId =
      typeof conv.maintenance_request_id === "string"
        ? conv.maintenance_request_id
        : null
    if (!ticketId) {
      return { handled: false }
    }
    const { data: pending } = await supabase
      .from("maintenance_estimates")
      .select("id, landlord_action_token")
      .eq("maintenance_request_id", ticketId)
      .eq("status", "pending_approval")
      .maybeSingle()
    if (!pending?.id) return { handled: false }
    awaiting = {
      estimateId: pending.id as string,
      actionToken:
        typeof pending.landlord_action_token === "string"
          ? pending.landlord_action_token
          : null,
      ticketId,
    }
  }

  let actionToken = awaiting.actionToken?.trim() || ""
  if (!actionToken) {
    const { data: row } = await supabase
      .from("maintenance_estimates")
      .select("landlord_action_token")
      .eq("id", awaiting.estimateId)
      .maybeSingle()
    actionToken =
      typeof row?.landlord_action_token === "string"
        ? row.landlord_action_token
        : ""
  }

  if (!actionToken) {
    return { handled: false }
  }

  const result = await decideMaintenanceEstimate(supabase, {
    estimateId: awaiting.estimateId,
    actionToken,
    action,
    source: "sms_inbound",
  })

  if (!result.ok) {
    console.error("[estimateDecisionInbound] decide failed", result.error)
    return {
      handled: true,
      action,
      estimateId: awaiting.estimateId,
      status: action === "approve" ? "approved" : "rejected",
      replyBody:
        "I couldn't update that estimate. Open the admin dashboard or use the approval link from the earlier text.",
    }
  }

  await clearAwaitingEstimateDecision(supabase, params.conversationId, priorIntake)

  // Also clear awaiting flag on the vendor job thread when present.
  if (awaiting.ticketId) {
    const { data: vendorThreads } = await supabase
      .from("sms_conversations")
      .select("id, intake_state")
      .eq("landlord_id", params.landlordId)
      .eq("maintenance_request_id", awaiting.ticketId)
      .eq("conversation_type", "vendor_alert")
      .limit(5)
    for (const thread of vendorThreads ?? []) {
      const intake =
        thread.intake_state && typeof thread.intake_state === "object"
          ? (thread.intake_state as Record<string, unknown>)
          : {}
      if (intake.awaiting_estimate_decision) {
        await clearAwaitingEstimateDecision(supabase, thread.id as string, intake)
      }
    }
  }

  const replyBody = result.already
    ? result.status === "approved"
      ? "This estimate was already approved. The vendor was notified."
      : "This estimate was already declined. The vendor was notified."
    : result.status === "approved"
      ? "Got it — estimate approved. The vendor can proceed with the work."
      : "Got it — estimate declined. The vendor has been notified."

  return {
    handled: true,
    action,
    estimateId: awaiting.estimateId,
    status: result.status,
    already: result.already,
    replyBody,
  }
}
