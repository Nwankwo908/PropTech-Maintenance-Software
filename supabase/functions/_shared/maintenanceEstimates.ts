/**
 * Vendor estimate submit + landlord 1-tap approve/reject (Phase 3 / 4.3).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { resolveLandlordId } from "./sms/landlordSmsOnboarding.ts"
import {
  appendEstimateDecisionStatusToVendorThread,
  appendMaintenanceEstimateSubmittedToInbox,
  resolveVendorJobConversationId,
} from "./sms/maintenanceEstimateInbox.ts"
import {
  buildEstimateDecisionStatusSms,
  resolveEstimateScheduleKickoff,
  vendorJobDecisionFromWorkStatus,
} from "./sms/workOrderAdminStatusSms.ts"
import { sendVendorJobAlert } from "./sms/vendorSmsRouting.ts"
import { formatWorkOrderRef } from "./vendor_outreach_copy.ts"
import { uloAppUrl } from "./uloAppUrl.ts"
import { loadLandlordApprovalLimits } from "./landlordNotificationPrefs.ts"
import {
  markEstimateNotificationDecided,
  notifyLandlordEstimatePending,
} from "./sms/landlordEstimateNotify.ts"
import {
  beginTenantConfirmForProposedWindow,
  setVendorAwaitingAvailability,
} from "./vendor_job_schedule.ts"
import { readVendorScheduleFsm } from "./vendor_schedule_fsm.ts"

export type EstimateMoneyInput = {
  partsCost: number
  laborCost: number
  totalCost?: number | null
  notes?: string | null
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function normalizeEstimateMoney(
  input: EstimateMoneyInput,
): { partsCost: number; laborCost: number; totalCost: number } | { error: string } {
  const parts = Number(input.partsCost)
  const labor = Number(input.laborCost)
  if (!Number.isFinite(parts) || parts < 0) {
    return { error: "Parts cost must be a non-negative number" }
  }
  if (!Number.isFinite(labor) || labor < 0) {
    return { error: "Labor cost must be a non-negative number" }
  }
  let total =
    input.totalCost == null || input.totalCost === undefined
      ? parts + labor
      : Number(input.totalCost)
  if (!Number.isFinite(total) || total < 0) {
    return { error: "Total must be a non-negative number" }
  }
  const partsR = roundMoney(parts)
  const laborR = roundMoney(labor)
  const totalR = roundMoney(total)
  if (totalR <= 0) {
    return { error: "Total must be greater than zero" }
  }
  return { partsCost: partsR, laborCost: laborR, totalCost: totalR }
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

async function notifyVendorEstimateDecision(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    estimateId: string
    approved: boolean
    totalCost: number
    workOrderRef: string
  },
): Promise<void> {
  const { data: vendor } = await supabase
    .from("vendors")
    .select("name, phone")
    .eq("id", params.vendorId)
    .maybeSingle()

  const phone = typeof vendor?.phone === "string" ? vendor.phone.trim() : ""
  if (!phone) return

  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select(
      "vendor_action_token, landlord_id, vendor_work_status, schedule_confirmed_at, resident_availability_text, scheduled_window_text, scheduled_at",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  const vendorDecision = vendorJobDecisionFromWorkStatus(
    typeof ticket?.vendor_work_status === "string"
      ? ticket.vendor_work_status
      : null,
  )
  // Declined vendors follow reassignment — do not send approval/continuation SMS.
  if (vendorDecision === "declined") {
    console.info("[maintenance-estimates] skip vendor decision SMS — job declined", {
      ticketId: params.ticketId,
      vendorId: params.vendorId,
    })
    return
  }

  const landlordId =
    typeof ticket?.landlord_id === "string" ? ticket.landlord_id : null

  let scheduleStep: string | null = null
  let scheduleTicketId: string | null = null
  let scheduleConversationId: string | null = null
  if (landlordId) {
    scheduleConversationId = await resolveVendorJobConversationId(supabase, {
      landlordId,
      ticketId: params.ticketId,
      vendorId: params.vendorId,
      vendorPhone: phone,
    })
    if (scheduleConversationId) {
      const { data: convo } = await supabase
        .from("sms_conversations")
        .select("intake_state")
        .eq("id", scheduleConversationId)
        .maybeSingle()
      const fsm = readVendorScheduleFsm(
        (convo?.intake_state as Record<string, unknown> | null) ?? null,
      )
      scheduleStep = fsm?.step ?? null
      scheduleTicketId = fsm?.ticketId ?? null
    }
  }

  const proposedWindow =
    typeof ticket?.scheduled_window_text === "string"
      ? ticket.scheduled_window_text.trim()
      : ""
  const proposedScheduledAt =
    typeof ticket?.scheduled_at === "string" ? ticket.scheduled_at : null

  const kickoff = resolveEstimateScheduleKickoff({
    approved: params.approved,
    vendorDecision,
    scheduleConfirmedAt:
      typeof ticket?.schedule_confirmed_at === "string"
        ? ticket.schedule_confirmed_at
        : null,
    scheduleStep,
    scheduleTicketId,
    ticketId: params.ticketId,
    proposedWindowText: proposedWindow || null,
    proposedScheduledAt,
  })

  const token =
    typeof ticket?.vendor_action_token === "string"
      ? ticket.vendor_action_token.trim()
      : ""
  const jobLink = token
    ? uloAppUrl.workOrder(token, { fallback: "" })
    : null
  const estimateLink = token
    ? uloAppUrl.estimate(token, { fallback: "" })
    : null

  const vendorName =
    typeof vendor?.name === "string" && vendor.name.trim()
      ? vendor.name.trim()
      : "there"

  const residentAvail =
    typeof ticket?.resident_availability_text === "string"
      ? ticket.resident_availability_text.trim()
      : ""

  const body = buildEstimateDecisionStatusSms({
    vendorName,
    workOrderRef: params.workOrderRef,
    approved: params.approved,
    totalCost: params.totalCost,
    jobLink,
    estimateLink,
    vendorDecision,
    includeScheduleAsk: kickoff.kind === "ask_vendor",
    confirmingWindowText:
      kickoff.kind === "confirm_tenant" ? kickoff.windowText : null,
    residentAvailabilityText: residentAvail || null,
  })
  if (!body) return

  const alertResult = await sendVendorJobAlert(supabase, {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
    vendorPhone: phone,
    body,
    landlordId,
  })
  if (!alertResult.ok) {
    console.error(
      "[maintenance-estimates] vendor decision SMS failed",
      alertResult.error,
    )
  }

  const conversationId =
    (alertResult.ok ? alertResult.conversationId : null) ||
    scheduleConversationId

  if (kickoff.kind === "confirm_tenant") {
    try {
      const confirm = await beginTenantConfirmForProposedWindow(supabase, {
        ticketId: params.ticketId,
        vendorId: params.vendorId,
        conversationId,
        windowText: kickoff.windowText,
        scheduledAt: kickoff.scheduledAt,
      })
      if (!confirm.ok) {
        console.error(
          "[maintenance-estimates] tenant confirm after estimate approve",
          confirm.error,
        )
      }
    } catch (e) {
      console.error(
        "[maintenance-estimates] tenant confirm after estimate approve",
        e,
      )
    }
  } else if (kickoff.kind === "ask_vendor") {
    if (conversationId) {
      try {
        await setVendorAwaitingAvailability(supabase, {
          conversationId,
          ticketId: params.ticketId,
        })
      } catch (e) {
        console.error(
          "[maintenance-estimates] schedule FSM after estimate approve",
          e,
        )
      }
    } else {
      console.info(
        "[maintenance-estimates] schedule kickoff skipped — no vendor thread",
        { ticketId: params.ticketId, vendorId: params.vendorId },
      )
    }
  }

  // If SMS routing missed the ticket-linked vendor thread (or send failed),
  // mirror the same status copy there so admins see it next to the estimate.
  if (landlordId) {
    const ticketThreadId = await resolveVendorJobConversationId(supabase, {
      landlordId,
      ticketId: params.ticketId,
      vendorId: params.vendorId,
      vendorPhone: phone,
    })
    const sentOnTicketThread =
      alertResult.ok &&
      ticketThreadId &&
      alertResult.conversationId === ticketThreadId

    if (!sentOnTicketThread) {
      await appendEstimateDecisionStatusToVendorThread(supabase, {
        landlordId,
        ticketId: params.ticketId,
        vendorId: params.vendorId,
        vendorPhone: phone,
        estimateId: params.estimateId,
        decision: params.approved ? "approved" : "rejected",
        body,
      })
    }
  }
}

export async function submitMaintenanceEstimate(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    money: EstimateMoneyInput
  },
): Promise<
  | { ok: true; estimateId: string; status: string }
  | { ok: false; error: string; status?: number }
> {
  const moneyNorm = normalizeEstimateMoney(params.money)
  if ("error" in moneyNorm) {
    return { ok: false, error: moneyNorm.error, status: 400 }
  }

  const { data: ticket, error: tErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, unit, assigned_vendor_id, vendor_work_status",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  if (tErr || !ticket) {
    return { ok: false, error: "Job not found", status: 404 }
  }
  if (ticket.assigned_vendor_id !== params.vendorId) {
    return { ok: false, error: "This job is not assigned to your company", status: 403 }
  }

  const landlordId =
    (typeof ticket.landlord_id === "string" && ticket.landlord_id.trim()) ||
    resolveLandlordId()

  // Supersede any prior pending estimate for this ticket.
  await supabase
    .from("maintenance_estimates")
    .update({ status: "superseded", updated_at: new Date().toISOString() })
    .eq("maintenance_request_id", params.ticketId)
    .eq("status", "pending_approval")

  const actionToken = crypto.randomUUID()
  const notes =
    typeof params.money.notes === "string" && params.money.notes.trim()
      ? params.money.notes.trim().slice(0, 2000)
      : null

  const { data: inserted, error: insErr } = await supabase
    .from("maintenance_estimates")
    .insert({
      maintenance_request_id: params.ticketId,
      landlord_id: landlordId,
      vendor_id: params.vendorId,
      parts_cost: moneyNorm.partsCost,
      labor_cost: moneyNorm.laborCost,
      total_cost: moneyNorm.totalCost,
      notes,
      status: "pending_approval",
      landlord_action_token: actionToken,
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single()

  if (insErr || !inserted?.id) {
    console.error("[maintenance-estimates] insert", insErr?.message)
    return {
      ok: false,
      error: insErr?.message || "Could not save estimate",
      status: 500,
    }
  }

  const estimateId = inserted.id as string

  const { escalationThreshold } =
    await loadLandlordApprovalLimits(supabase, landlordId)

  const { data: vendor } = await supabase
    .from("vendors")
    .select("name, phone, email")
    .eq("id", params.vendorId)
    .maybeSingle()
  const vendorName =
    typeof vendor?.name === "string" && vendor.name.trim()
      ? vendor.name.trim()
      : "Vendor"
  const vendorPhone = typeof vendor?.phone === "string" ? vendor.phone : null

  try {
    await appendMaintenanceEstimateSubmittedToInbox(supabase, {
      landlordId,
      ticketId: params.ticketId,
      vendorId: params.vendorId,
      vendorPhone,
      estimateId,
      partsCost: moneyNorm.partsCost,
      laborCost: moneyNorm.laborCost,
      totalCost: moneyNorm.totalCost,
      notes,
      unit: typeof ticket.unit === "string" ? ticket.unit : "",
    })
  } catch (e) {
    console.error("[maintenance-estimates] inbox mirror", e)
  }

  try {
    await notifyLandlordEstimatePending(supabase, {
      landlordId,
      estimateId,
      actionToken,
      ticketId: params.ticketId,
      unit: typeof ticket.unit === "string" ? ticket.unit : "",
      vendorId: params.vendorId,
      vendorName,
      vendorEmail: typeof vendor?.email === "string" ? vendor.email : null,
      partsCost: moneyNorm.partsCost,
      laborCost: moneyNorm.laborCost,
      totalCost: moneyNorm.totalCost,
      notes,
      exceedsEscalationThreshold:
        Number.isFinite(escalationThreshold) &&
        moneyNorm.totalCost > escalationThreshold,
    })
  } catch (e) {
    console.error("[maintenance-estimates] landlord notify", e)
  }

  try {
    await recordActivityLog(supabase, {
      landlordId,
      eventType: "maintenance.estimate_submitted",
      source: "vendor_portal",
      actorType: "vendor",
      actorId: params.vendorId,
      vendorId: params.vendorId,
      maintenanceRequestId: params.ticketId,
      metadata: {
        estimate_id: estimateId,
        parts_cost: moneyNorm.partsCost,
        labor_cost: moneyNorm.laborCost,
        total_cost: moneyNorm.totalCost,
        message: `${vendorName} submitted an estimate of ${money(moneyNorm.totalCost)} for ${formatWorkOrderRef(params.ticketId)}. Waiting for your approval.`,
      },
    })
  } catch (e) {
    console.error("[maintenance-estimates] graph", e)
  }

  return { ok: true, estimateId, status: "pending_approval" }
}

export async function decideMaintenanceEstimate(
  supabase: SupabaseClient,
  params: {
    estimateId: string
    actionToken: string
    action: "approve" | "reject"
    /** Where the decision came from (maps to operations graph source). */
    source?: "sms" | "sms_inbound" | "admin" | "email_link"
  },
): Promise<
  | { ok: true; status: "approved" | "rejected"; already?: boolean }
  | { ok: false; error: string; status?: number }
> {
  const { data: row, error } = await supabase
    .from("maintenance_estimates")
    .select(
      "id, status, landlord_id, vendor_id, maintenance_request_id, landlord_action_token, total_cost, vendor_notified_at",
    )
    .eq("id", params.estimateId)
    .maybeSingle()

  if (error || !row) {
    return { ok: false, error: "Estimate not found", status: 404 }
  }
  if (row.landlord_action_token !== params.actionToken) {
    return { ok: false, error: "Invalid or expired link", status: 403 }
  }

  if (row.status === "approved" || row.status === "rejected") {
    await markEstimateNotificationDecided(supabase, params.estimateId).catch(
      () => {},
    )
    return {
      ok: true,
      status: row.status as "approved" | "rejected",
      already: true,
    }
  }
  if (row.status !== "pending_approval") {
    await markEstimateNotificationDecided(supabase, params.estimateId).catch(
      () => {},
    )
    return { ok: false, error: "This estimate can no longer be updated", status: 409 }
  }

  const next = params.action === "approve" ? "approved" : "rejected"
  const nowIso = new Date().toISOString()
  const { error: upErr } = await supabase
    .from("maintenance_estimates")
    .update({
      status: next,
      decided_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", params.estimateId)
    .eq("status", "pending_approval")

  if (upErr) {
    console.error("[maintenance-estimates] decide", upErr.message)
    return { ok: false, error: "Could not update estimate", status: 500 }
  }

  const ticketId = row.maintenance_request_id as string
  const vendorId = row.vendor_id as string
  const wo = formatWorkOrderRef(ticketId)

  try {
    await notifyVendorEstimateDecision(supabase, {
      ticketId,
      vendorId,
      estimateId: params.estimateId,
      approved: next === "approved",
      totalCost: Number(row.total_cost) || 0,
      workOrderRef: wo,
    })
    await supabase
      .from("maintenance_estimates")
      .update({ vendor_notified_at: new Date().toISOString() })
      .eq("id", params.estimateId)
  } catch (e) {
    console.error("[maintenance-estimates] vendor notify", e)
  }

  const graphSource =
    params.source === "admin"
      ? "dashboard"
      : params.source === "sms_inbound" || params.source === "email_link"
        ? "sms"
        : "sms"

  try {
    await recordActivityLog(supabase, {
      landlordId: row.landlord_id as string,
      eventType:
        next === "approved"
          ? "maintenance.estimate_approved"
          : "maintenance.estimate_rejected",
      source: graphSource,
      actorType: "landlord",
      vendorId,
      maintenanceRequestId: ticketId,
      metadata: {
        estimate_id: params.estimateId,
        total_cost: Number(row.total_cost) || 0,
        decision_channel: params.source ?? "sms",
        message:
          next === "approved"
            ? `Estimate of ${money(Number(row.total_cost) || 0)} approved for ${wo}. Ulo is aligning the visit time with the resident.`
            : `Estimate of ${money(Number(row.total_cost) || 0)} was not approved for ${wo}. The vendor was asked to submit an updated estimate.`,
      },
    })
  } catch (e) {
    console.error("[maintenance-estimates] graph decide", e)
  }

  await markEstimateNotificationDecided(supabase, params.estimateId).catch(() => {})

  return { ok: true, status: next }
}

export async function loadEstimateContextForJobToken(
  supabase: SupabaseClient,
  jobToken: string,
): Promise<
  | {
      ok: true
      ticketId: string
      vendorId: string
      workOrderRef: string
      unit: string
      description: string
      pendingEstimate: {
        id: string
        partsCost: number
        laborCost: number
        totalCost: number
        notes: string | null
        status: string
      } | null
    }
  | { ok: false; error: string; status: number }
> {
  const { data: ticket, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, unit, description, assigned_vendor_id, vendor_action_token",
    )
    .eq("vendor_action_token", jobToken)
    .maybeSingle()

  if (error || !ticket?.id) {
    return { ok: false, error: "Job not found", status: 404 }
  }
  if (typeof ticket.assigned_vendor_id !== "string" || !ticket.assigned_vendor_id) {
    return { ok: false, error: "No vendor assigned to this job", status: 400 }
  }

  const { data: pending } = await supabase
    .from("maintenance_estimates")
    .select("id, parts_cost, labor_cost, total_cost, notes, status")
    .eq("maintenance_request_id", ticket.id)
    .eq("status", "pending_approval")
    .maybeSingle()

  return {
    ok: true,
    ticketId: ticket.id as string,
    vendorId: ticket.assigned_vendor_id,
    workOrderRef: formatWorkOrderRef(ticket.id as string),
    unit: typeof ticket.unit === "string" ? ticket.unit : "",
    description: typeof ticket.description === "string" ? ticket.description : "",
    pendingEstimate: pending
      ? {
          id: pending.id as string,
          partsCost: Number(pending.parts_cost) || 0,
          laborCost: Number(pending.labor_cost) || 0,
          totalCost: Number(pending.total_cost) || 0,
          notes: typeof pending.notes === "string" ? pending.notes : null,
          status: String(pending.status),
        }
      : null,
  }
}
