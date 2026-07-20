/**
 * Mint a real maintenance_requests row as soon as SMS intake is classifiable.
 * Prevents phantom WO refs from sms_conversation ids and keeps Active Tasks durable.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { getEstimatedMinutes } from "../sla_rules.ts"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { updateWorkflowRun } from "../engine/workflowRuns.ts"
import { issueCategoryToVendorTrade } from "../vendor_trades.ts"
import {
  buildIntakeDescription,
  resolveIntakeIssueCategory,
  severityToDb,
  type SmsIntakeState,
} from "./residentIntakeTypes.ts"

type ResidentRow = {
  id: string
  full_name: string
  email: string
  phone: string | null
  unit: string | null
}

function isMidIntake(state: SmsIntakeState): boolean {
  const step = state.step
  return Boolean(step && step !== "submitted")
}

/** Enough signal to create a durable ticket (not waiting on vague clarification only). */
export function shouldMintEarlyTicket(state: SmsIntakeState): boolean {
  if (state.step === "classification_clarification") return false
  if (state.step === "submitted") return false
  const hasTrade =
    Boolean(state.vendor_trade?.trim()) && state.vendor_trade !== "other"
  const hasIssue = Boolean(state.issue_type?.trim())
  const hasDescription = Boolean(
    (state.initial_message ?? state.description ?? "").trim(),
  )
  return hasDescription && (hasTrade || hasIssue)
}

/**
 * Ensure the conversation is linked to a real maintenance_requests row.
 * Creates when missing; patches description/category while intake is still open.
 * Does not assign vendors — that happens on final submit.
 */
export async function ensureEarlySmsMaintenanceTicket(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    residentId: string
    intake: SmsIntakeState
    workflowRunId?: string | null
  },
): Promise<{ ticketId: string | null; created: boolean }> {
  if (!shouldMintEarlyTicket(params.intake)) {
    return { ticketId: null, created: false }
  }

  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("workflow_run_id")
    .eq("id", params.conversationId)
    .maybeSingle()

  const runId =
    params.workflowRunId?.trim() ||
    (typeof convo?.workflow_run_id === "string" ? convo.workflow_run_id.trim() : "") ||
    null

  const draftId = params.intake.draft_ticket_id?.trim() || ""

  const { data: resident, error: residentErr } = await supabase
    .from("users")
    .select("id, full_name, email, phone, unit")
    .eq("id", params.residentId)
    .maybeSingle()

  if (residentErr || !resident) {
    console.error("[sms-intake] early ticket resident lookup", residentErr?.message)
    return { ticketId: draftId || null, created: false }
  }

  const row = resident as ResidentRow
  const unit = row.unit?.trim()
  if (!unit) {
    console.warn("[sms-intake] early ticket skipped — resident has no unit")
    return { ticketId: draftId || null, created: false }
  }

  const issueCategory = issueCategoryToVendorTrade(
    resolveIntakeIssueCategory(params.intake),
  )
  const priority = params.intake.urgency?.trim() || "normal"
  const dbSeverity = severityToDb(params.intake.severity)
  const estimatedMinutes = getEstimatedMinutes(issueCategory, dbSeverity)
  const dueAt = new Date(Date.now() + estimatedMinutes * 60_000)
  const description = buildIntakeDescription(params.intake)

  // Only reuse the ticket minted for *this* intake (never a prior conversation ticket).
  if (draftId && isMidIntake(params.intake)) {
    const { error: updateErr } = await supabase
      .from("maintenance_requests")
      .update({
        description,
        issue_category: issueCategory,
        priority,
        urgency: priority,
        severity: dbSeverity,
        estimated_minutes: estimatedMinutes,
        due_at: dueAt.toISOString(),
        resident_name: row.full_name?.trim() || "Resident",
        resident_phone: row.phone,
      })
      .eq("id", draftId)

    if (updateErr) {
      console.error("[sms-intake] early ticket patch failed", updateErr.message)
    }

    await supabase
      .from("sms_conversations")
      .update({
        maintenance_request_id: draftId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.conversationId)

    await linkRunToTicket(supabase, runId, draftId, params.intake)
    return { ticketId: draftId, created: false }
  }

  const { data: ticket, error: insertErr } = await supabase
    .from("maintenance_requests")
    .insert({
      landlord_id: params.landlordId,
      priority,
      urgency: priority,
      resident_name: row.full_name?.trim() || "Resident",
      email: row.email?.trim() || `${params.residentId}@sms-resident.ulohome.local`,
      resident_phone: row.phone,
      unit,
      description,
      resident_user_id: null,
      photo_paths: [],
      issue_category: issueCategory,
      severity: dbSeverity,
      estimated_minutes: estimatedMinutes,
      due_at: dueAt.toISOString(),
      vendor_work_status: "unassigned",
    })
    .select("id")
    .single()

  if (insertErr || !ticket?.id) {
    console.error("[sms-intake] early ticket insert failed", insertErr?.message)
    return { ticketId: null, created: false }
  }

  const ticketId = ticket.id as string

  await supabase
    .from("sms_conversations")
    .update({
      maintenance_request_id: ticketId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId)

  await linkRunToTicket(supabase, runId, ticketId, params.intake)

  try {
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "maintenance.request_drafted",
      source: "sms",
      actor_type: "system",
      resident_id: params.residentId,
      maintenance_request_id: ticketId,
      conversation_id: params.conversationId,
      workflow_run_id: runId,
      workflow_template_id: "maintenance_intake",
      metadata: {
        unit,
        issue_category: issueCategory,
        intake_step: params.intake.step,
        early_ticket: true,
      },
    })
  } catch (e) {
    console.warn("[sms-intake] early ticket graph event failed", e)
  }

  console.info("[sms-intake] early maintenance ticket minted", {
    ticketId,
    conversationId: params.conversationId,
    issueCategory,
    step: params.intake.step,
  })

  return { ticketId, created: true }
}

/** Persist draft_ticket_id onto intake state after minting. */
export function withDraftTicketId(
  state: SmsIntakeState,
  ticketId: string | null,
): SmsIntakeState {
  if (!ticketId) return state
  if (state.draft_ticket_id === ticketId) return state
  return { ...state, draft_ticket_id: ticketId }
}

async function linkRunToTicket(
  supabase: SupabaseClient,
  runId: string | null,
  ticketId: string,
  intake: SmsIntakeState,
): Promise<void> {
  if (!runId) return
  await updateWorkflowRun(supabase, runId, {
    entityType: "maintenance_request",
    entityId: ticketId,
    currentStep: typeof intake.step === "string" ? intake.step : "collecting",
    metadata: {
      intake_state: intake as Record<string, unknown>,
      early_ticket: true,
    },
    eventMessage: "Linked SMS intake to durable maintenance ticket",
    eventStep: typeof intake.step === "string" ? intake.step : "collecting",
  })
}
