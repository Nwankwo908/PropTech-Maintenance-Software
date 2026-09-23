/**
 * Central terminateWorkOrder — every cancel / archive / vendor-release path.
 *
 * Sequence (never reverse):
 * 1. Persist termination row + soft-close ticket (cancel/archive) or capture release
 * 2. Create vendor notify intent on that row
 * 3. Attempt SMS + email independently with attempt logging
 *
 * Pending state never depends on delivery success. Idempotent for cancel/archive.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { sendResendEmail } from "./delivery.ts"
import { sendLandlordOpsEmail } from "./landlordOpsNotify.ts"
import { updateWorkflowRun } from "./engine/workflowRuns.ts"
import { formatWorkOrderRef, vendorCompanyName } from "./vendor_outreach_copy.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "./sms/inbound_db.ts"
import { getSMSProviderForSend } from "./sms/providerFactory.ts"
import { resolveVendorAlertSenderNumber } from "./sms/vendorSmsRouting.ts"
import { releaseMaintenanceIntakePin } from "./sms/residentIntake.ts"
import { runLinksCancelledTicket } from "./sms/cancelResidentWorkOrderLink.ts"
import type { SmsIntakeState } from "./sms/residentIntakeTypes.ts"

export const MAX_TERMINATE_SMS_ATTEMPTS = 3
export const TERMINATE_NOTIFY_SOURCE = "work_order_terminate_notify"

export type TerminateMode = "cancel" | "archive" | "release"
export type TerminateSource =
  | "resident_sms"
  | "dashboard"
  | "emergency_decline"
  | "reassignment"
  | "cleanup"
  | "admin_api"
  | "automation"

export type TerminateDeliveryStatus =
  | "sent"
  | "delivered"
  | "failed"
  | "skipped"
  | "no_response"

export type TerminateWorkOrderParams = {
  landlordId: string
  ticketId: string
  mode: TerminateMode
  source: TerminateSource
  actorType?: "resident" | "landlord" | "system" | "vendor" | "admin"
  actorId?: string | null
  reason?: string | null
  /** Override vendor to notify (defaults to assigned_vendor_id). */
  vendorId?: string | null
  conversationId?: string | null
  residentId?: string | null
  intake?: SmsIntakeState | null
  lastResidentMessage?: string | null
  descriptionNote?: string | null
  closeWorkflowRuns?: boolean
  notifyVendor?: boolean
  /** When true (default for cancel/archive), clear assigned_vendor_id. */
  clearAssignment?: boolean
}

export type TerminateWorkOrderResult = {
  ok: true
  alreadyTerminated?: boolean
  terminationId: string | null
  ticketId: string
  mode: TerminateMode
  previousVendorId: string | null
  previousStatus: string | null
  vendorNotify: "notified" | "failed" | "skipped" | "not_required" | "pending"
  landlordPaymentWarning: boolean
} | {
  ok: false
  error: string
}

type TerminationRow = {
  id: string
  ticket_id: string
  landlord_id: string
  mode: string
  previous_vendor_id: string | null
  notify_status: string
  sms_attempt_count: number
  email_attempt_count: number
  sms_body: string | null
  staff_alerted_at: string | null
  conversation_id: string | null
  last_sms_error: string | null
}

const MAINTENANCE_TEMPLATES = ["maintenance_intake", "maintenance_request"] as const

/** Vendor-facing job phase at cancel time (from vendor_work_status). */
export type VendorTerminateJobPhase = "not_started" | "in_progress" | "completed"

/**
 * Internal cancel reasons → short vendor-safe phrases.
 * Keys are lowercased trimmed strings. Empty mapped value = omit reason line.
 */
const VENDOR_TERMINATE_REASON_COPY: Record<string, string> = {
  "archived from the workflow pipeline": "The property team closed this job.",
  "archived by the property team": "The property team closed this job.",
  "resident cancelled": "The resident cancelled this repair.",
  "resident canceled": "The resident cancelled this repair.",
  "job reassigned": "This job was given to another vendor.",
  cancelled: "This repair is no longer needed.",
  canceled: "This repair is no longer needed.",
}

export function resolveVendorTerminateJobPhase(
  vendorWorkStatus: string | null | undefined,
): VendorTerminateJobPhase {
  const s = (vendorWorkStatus ?? "").trim().toLowerCase()
  if (s === "completed") return "completed"
  if (s === "in_progress") return "in_progress"
  // pending_accept, accepted, empty, unknown → treat as not started
  return "not_started"
}

/**
 * Map an internal cancellation reason to vendor-safe copy.
 * Unmapped reasons never fall back to the raw string — omit the reason line.
 */
export function mapVendorTerminateReason(
  reason: string | null | undefined,
): { vendorText: string | null; unmapped: boolean; raw: string | null } {
  const raw = reason?.trim() || null
  if (!raw) return { vendorText: null, unmapped: false, raw: null }
  const key = raw.toLowerCase()
  if (Object.prototype.hasOwnProperty.call(VENDOR_TERMINATE_REASON_COPY, key)) {
    const mapped = VENDOR_TERMINATE_REASON_COPY[key]!.trim()
    return { vendorText: mapped || null, unmapped: false, raw }
  }
  console.warn("[terminate-wo] unmapped cancel reason — omitted from vendor SMS", {
    reason: raw,
  })
  return { vendorText: null, unmapped: true, raw }
}

export function formatVendorTerminateVisitWindow(input: {
  scheduledWindowText?: string | null
  scheduledAt?: string | null
}): string | null {
  const window = input.scheduledWindowText?.trim()
  if (window) return window
  const at = input.scheduledAt?.trim()
  if (!at) return null
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return null
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d)
  } catch {
    return at
  }
}

function sourceLabel(source: TerminateSource): string {
  switch (source) {
    case "resident_sms":
      return "the resident"
    case "emergency_decline":
      return "the property team (emergency review)"
    case "reassignment":
      return "the property team (reassignment)"
    case "cleanup":
      return "an automated cleanup"
    case "admin_api":
    case "dashboard":
      return "the property team"
    default:
      return "the property team"
  }
}

/**
 * Vendor terminate / cancel SMS.
 * Returns null when the job was already completed — caller must not send and
 * should alert staff instead.
 *
 * Layout (matches compact vendor SMS):
 *   {Status} — {WO} · Unit {n}
 *   {VendorCompany}
 *
 *   {branched body}
 *   Reason: {mapped}   ← only when a vendor-safe mapping exists
 */
export function buildVendorTerminateSms(params: {
  vendorName: string
  workOrderRef: string
  propertyLabel: string
  unit: string
  reason: string | null
  mode: TerminateMode
  /** vendor_work_status at cancel time */
  vendorWorkStatus?: string | null
  scheduledWindowText?: string | null
  scheduledAt?: string | null
}): string | null {
  const phase = resolveVendorTerminateJobPhase(params.vendorWorkStatus)
  if (phase === "completed") return null

  const company = vendorCompanyName(params.vendorName)
  const wo = params.workOrderRef.trim() || "this work order"
  const unit = params.unit.trim()
  const unitPart = unit
    ? (unit.toLowerCase().startsWith("unit") ? unit : `Unit ${unit}`)
    : ""
  const statusWord = params.mode === "release" ? "Reassigned" : "Cancelled"
  const line1 = [statusWord, "—", wo, unitPart ? `· ${unitPart}` : null]
    .filter(Boolean)
    .join(" ")

  const visitWindow = formatVendorTerminateVisitWindow({
    scheduledWindowText: params.scheduledWindowText,
    scheduledAt: params.scheduledAt,
  })

  const bodyLines: string[] = []
  if (phase === "in_progress") {
    bodyLines.push(
      params.mode === "release"
        ? "Please stop work now — this job has been reassigned."
        : "Please stop work now — this job has been cancelled.",
    )
  } else {
    // not_started
    if (visitWindow) {
      bodyLines.push(
        `Your ${visitWindow} visit is no longer needed — no need to come out.`,
      )
    } else {
      bodyLines.push(
        params.mode === "release"
          ? "This visit is no longer needed — the job was reassigned."
          : "This visit is no longer needed — no need to come out.",
      )
    }
    bodyLines.push(
      "If you're already on site or started work, please stop and text us.",
    )
  }

  const mapped = mapVendorTerminateReason(
    params.mode === "release" ? null : params.reason,
  )
  if (mapped.vendorText) {
    bodyLines.push("", `Reason: ${mapped.vendorText}`)
  }

  return [line1, company, "", ...bodyLines].join("\n")
}

export function buildVendorTerminateEmail(params: {
  vendorName: string
  workOrderRef: string
  propertyLabel: string
  unit: string
  reason: string | null
  mode: TerminateMode
  vendorWorkStatus?: string | null
  scheduledWindowText?: string | null
  scheduledAt?: string | null
}): { subject: string; text: string; html: string } | null {
  const sms = buildVendorTerminateSms(params)
  if (!sms) return null
  const subject =
    params.mode === "release"
      ? `Job update: ${params.workOrderRef} reassigned`
      : `Job cancelled: ${params.workOrderRef}`
  return {
    subject,
    text: sms,
    html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;">${sms.replace(/</g, "&lt;")}</pre>`,
  }
}

export function shouldWarnLandlordPayment(params: {
  previousStatus: string | null
  hadApprovedEstimate: boolean
}): boolean {
  const s = (params.previousStatus ?? "").toLowerCase()
  if (params.hadApprovedEstimate) return true
  return s === "accepted" || s === "in_progress" || s === "completed"
}

async function loadLinkedActiveMaintenanceRuns(
  supabase: SupabaseClient,
  params: { landlordId: string; ticketId: string; residentId?: string | null },
): Promise<Array<{ id: string }>> {
  const base = () =>
    supabase
      .from("workflow_runs")
      .select("id, entity_id, entity_type, metadata, template_id, resident_id")
      .eq("landlord_id", params.landlordId)
      .in("status", ["active", "escalated"])
      .in("template_id", [...MAINTENANCE_TEMPLATES])

  const queries = [
    base().eq("entity_id", params.ticketId),
    base().eq("metadata->>draft_ticket_id", params.ticketId),
    base().eq("metadata->>maintenance_request_id", params.ticketId),
  ]

  const seen = new Set<string>()
  const out: Array<{ id: string }> = []
  for (const query of queries) {
    const { data } = await query.limit(20)
    const residentId = params.residentId?.trim() || ""
    for (const row of data ?? []) {
      const id = typeof row?.id === "string" ? row.id : ""
      if (!id || seen.has(id)) continue
      if (
        residentId &&
        typeof row.resident_id === "string" &&
        row.resident_id.trim() &&
        row.resident_id.trim() !== residentId
      ) {
        continue
      }
      if (
        !runLinksCancelledTicket(
          row as {
            entity_id?: string | null
            entity_type?: string | null
            metadata?: Record<string, unknown> | null
          },
          params.ticketId,
        )
      ) {
        continue
      }
      seen.add(id)
      out.push({ id })
    }
  }
  return out
}

async function recordTerminateAttempt(
  supabase: SupabaseClient,
  params: {
    terminationId: string
    ticketId: string
    landlordId: string
    channel: "sms" | "email"
    phone?: string | null
    email?: string | null
    deliveryStatus: TerminateDeliveryStatus
    failureReason?: string | null
    providerMessageSid?: string | null
    attemptNumber: number
    conversationId?: string | null
  },
): Promise<void> {
  const { error } = await supabase.from("work_order_terminate_notify_attempts").insert({
    termination_id: params.terminationId,
    ticket_id: params.ticketId,
    landlord_id: params.landlordId,
    channel: params.channel,
    phone: params.phone?.trim() || null,
    email: params.email?.trim() || null,
    delivery_status: params.deliveryStatus,
    failure_reason: params.failureReason?.trim() || null,
    provider_message_sid: params.providerMessageSid?.trim() || null,
    attempt_number: params.attemptNumber,
    conversation_id: params.conversationId?.trim() || null,
  })
  if (error) {
    console.error("[terminate-wo] attempt insert", error.message)
  }
}

async function closeLinkedRuns(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    residentId?: string | null
    mode: TerminateMode
    source: TerminateSource
  },
): Promise<void> {
  const runs = await loadLinkedActiveMaintenanceRuns(supabase, {
    landlordId: params.landlordId,
    ticketId: params.ticketId,
    residentId: params.residentId,
  })
  const now = new Date().toISOString()
  for (const run of runs) {
    await updateWorkflowRun(supabase, run.id, {
      status: "cancelled",
      currentStep:
        params.mode === "archive" ? "archived" : "cancelled_via_terminate",
      completedAt: now,
      eventMessage:
        params.mode === "archive"
          ? "Work order archived."
          : "Work order cancelled.",
      eventStep: "terminate_work_order",
      metadata: {
        cancelled_reason: params.source,
        closed_source: params.source,
        closed_at: now,
        terminate_mode: params.mode,
      },
    })
  }
}

/**
 * Soft-close (cancel/archive) or release-notify a work order.
 */
export async function terminateWorkOrder(
  supabase: SupabaseClient,
  params: TerminateWorkOrderParams,
): Promise<TerminateWorkOrderResult> {
  const ticketId = params.ticketId.trim()
  const landlordId = params.landlordId.trim()
  if (!ticketId || !landlordId) {
    return { ok: false, error: "missing_ticket_or_landlord" }
  }

  const { data: ticket, error: tErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, unit, description, issue_headline, property_id, assigned_vendor_id, vendor_work_status, cancelled_at, previous_vendor_id, cancellation_reason, scheduled_window_text, scheduled_at, schedule_confirmed_at",
    )
    .eq("id", ticketId)
    .eq("landlord_id", landlordId)
    .maybeSingle()

  if (tErr || !ticket) {
    return { ok: false, error: tErr?.message || "ticket_not_found" }
  }

  const currentStatus = String(ticket.vendor_work_status ?? "").toLowerCase()
  const assignedVendorId =
    (typeof params.vendorId === "string" && params.vendorId.trim()) ||
    (typeof ticket.assigned_vendor_id === "string"
      ? ticket.assigned_vendor_id.trim()
      : "") ||
    null

  // Idempotent cancel/archive: already terminal — do not destroy original details.
  if (
    (params.mode === "cancel" || params.mode === "archive") &&
    (currentStatus === "cancelled" || currentStatus === "archived")
  ) {
    const { data: existing } = await supabase
      .from("work_order_terminations")
      .select(
        "id, ticket_id, landlord_id, mode, previous_vendor_id, notify_status, sms_attempt_count, email_attempt_count, sms_body, staff_alerted_at, conversation_id, last_sms_error",
      )
      .eq("ticket_id", ticketId)
      .in("mode", ["cancel", "archive"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    return {
      ok: true,
      alreadyTerminated: true,
      terminationId: existing?.id ?? null,
      ticketId,
      mode: params.mode,
      previousVendorId:
        (existing?.previous_vendor_id as string | null) ??
        (ticket.previous_vendor_id as string | null) ??
        null,
      previousStatus: currentStatus,
      vendorNotify: mapNotifyStatus(existing?.notify_status),
      landlordPaymentWarning: false,
    }
  }

  const { data: approvedEstimate } = await supabase
    .from("maintenance_estimates")
    .select("id")
    .eq("maintenance_request_id", ticketId)
    .eq("status", "approved")
    .limit(1)
    .maybeSingle()

  const hadApprovedEstimate = Boolean(approvedEstimate?.id)
  const warnPayment = shouldWarnLandlordPayment({
    previousStatus: currentStatus,
    hadApprovedEstimate,
  })

  let propertyLabel = ""
  if (typeof ticket.property_id === "string" && ticket.property_id) {
    const { data: prop } = await supabase
      .from("properties")
      .select("address, name")
      .eq("id", ticket.property_id)
      .maybeSingle()
    propertyLabel =
      (typeof prop?.address === "string" && prop.address.trim()) ||
      (typeof prop?.name === "string" && prop.name.trim()) ||
      ""
  }

  const unit = typeof ticket.unit === "string" ? ticket.unit : ""
  const wo = formatWorkOrderRef(ticketId)
  const reason =
    (params.reason?.trim() ||
      (params.mode === "archive"
        ? "Archived by the property team"
        : params.mode === "release"
          ? "Job reassigned"
          : "Cancelled")) ||
    null
  const reasonMapped = mapVendorTerminateReason(
    params.mode === "release" ? null : reason,
  )
  if (reasonMapped.unmapped && reasonMapped.raw) {
    await recordActivityLog(supabase, {
      landlordId,
      eventType: "maintenance.terminate_reason_unmapped",
      source: "automation",
      actorType: "system",
      maintenanceRequestId: ticketId,
      metadata: {
        reason: reasonMapped.raw,
        message:
          `Cancel reason needs vendor-safe copy: "${reasonMapped.raw}"`,
      },
    }).catch(() => {})
  }

  const scheduledWindowText =
    typeof ticket.scheduled_window_text === "string"
      ? ticket.scheduled_window_text
      : null
  const scheduledAt =
    typeof ticket.scheduled_at === "string" ? ticket.scheduled_at : null

  let vendorName = "there"
  let vendorPhone: string | null = null
  let vendorEmail: string | null = null
  if (assignedVendorId) {
    const { data: vendor } = await supabase
      .from("vendors")
      .select("id, name, phone, email")
      .eq("id", assignedVendorId)
      .maybeSingle()
    if (typeof vendor?.name === "string" && vendor.name.trim()) {
      vendorName = vendor.name.trim()
    }
    vendorPhone =
      typeof vendor?.phone === "string" && vendor.phone.trim()
        ? vendor.phone.trim()
        : null
    vendorEmail =
      typeof vendor?.email === "string" && vendor.email.trim()
        ? vendor.email.trim()
        : null
  }

  const jobPhase = resolveVendorTerminateJobPhase(currentStatus)
  const smsBody = assignedVendorId
    ? buildVendorTerminateSms({
      vendorName,
      workOrderRef: wo,
      propertyLabel,
      unit,
      reason,
      mode: params.mode,
      vendorWorkStatus: currentStatus,
      scheduledWindowText,
      scheduledAt,
    })
    : null
  const emailCopy = assignedVendorId
    ? buildVendorTerminateEmail({
      vendorName,
      workOrderRef: wo,
      propertyLabel,
      unit,
      reason,
      mode: params.mode,
      vendorWorkStatus: currentStatus,
      scheduledWindowText,
      scheduledAt,
    })
    : null

  // Completed jobs: never send the cancel template — staff must review.
  const skipVendorNotifyCompleted =
    Boolean(assignedVendorId) && jobPhase === "completed"
  const notifyWanted =
    params.notifyVendor !== false &&
    Boolean(assignedVendorId) &&
    !skipVendorNotifyCompleted
  const nowIso = new Date().toISOString()

  // 1) Insert termination row BEFORE delivery (and before clearing assignment).
  const { data: termination, error: termErr } = await supabase
    .from("work_order_terminations")
    .insert({
      ticket_id: ticketId,
      landlord_id: landlordId,
      mode: params.mode,
      source: params.source,
      actor_type: params.actorType ?? null,
      actor_id: params.actorId ?? null,
      reason,
      previous_vendor_id: assignedVendorId,
      previous_vendor_work_status: currentStatus || null,
      sms_body: smsBody,
      email_subject: emailCopy?.subject ?? null,
      notify_status: skipVendorNotifyCompleted
        ? "skipped"
        : notifyWanted
          ? "pending"
          : "not_required",
      conversation_id: params.conversationId?.trim() || null,
      updated_at: nowIso,
    })
    .select(
      "id, ticket_id, landlord_id, mode, previous_vendor_id, notify_status, sms_attempt_count, email_attempt_count, sms_body, staff_alerted_at, conversation_id, last_sms_error",
    )
    .single()

  if (termErr || !termination) {
    // Unique terminal conflict → treat as already terminated.
    if (termErr?.code === "23505" && params.mode !== "release") {
      const { data: existing } = await supabase
        .from("work_order_terminations")
        .select(
          "id, ticket_id, landlord_id, mode, previous_vendor_id, notify_status, sms_attempt_count, email_attempt_count, sms_body, staff_alerted_at, conversation_id, last_sms_error",
        )
        .eq("ticket_id", ticketId)
        .in("mode", ["cancel", "archive"])
        .maybeSingle()
      return {
        ok: true,
        alreadyTerminated: true,
        terminationId: existing?.id ?? null,
        ticketId,
        mode: params.mode,
        previousVendorId: existing?.previous_vendor_id ?? assignedVendorId,
        previousStatus: currentStatus,
        vendorNotify: mapNotifyStatus(existing?.notify_status),
        landlordPaymentWarning: false,
      }
    }
    console.error("[terminate-wo] insert termination", termErr?.message)
    return { ok: false, error: termErr?.message || "termination_insert_failed" }
  }

  // 2) Soft-close ticket for cancel/archive.
  if (params.mode === "cancel" || params.mode === "archive") {
    const clearAssignment = params.clearAssignment !== false
    const note =
      params.descriptionNote?.trim() ||
      `Work order ${params.mode === "archive" ? "archived" : "cancelled"} (${params.source}) on ${nowIso.slice(0, 10)}.`
    const nextDescription = [
      typeof ticket.description === "string" ? ticket.description.trim() : "",
      note,
    ]
      .filter(Boolean)
      .join("\n\n")

    const patch: Record<string, unknown> = {
      vendor_work_status: params.mode === "archive" ? "archived" : "cancelled",
      cancelled_at: nowIso,
      cancelled_by: params.actorType
        ? `${params.actorType}:${params.source}`
        : params.source,
      cancellation_reason: reason,
      previous_vendor_id: assignedVendorId,
      previous_vendor_work_status: currentStatus || null,
      description: nextDescription,
    }
    if (clearAssignment) {
      patch.assigned_vendor_id = null
    }

    const { error: upErr } = await supabase
      .from("maintenance_requests")
      .update(patch)
      .eq("id", ticketId)
      .eq("landlord_id", landlordId)

    if (upErr) {
      console.error("[terminate-wo] ticket update", upErr.message)
      return { ok: false, error: upErr.message }
    }

    if (params.closeWorkflowRuns !== false) {
      await closeLinkedRuns(supabase, {
        landlordId,
        ticketId,
        residentId: params.residentId,
        mode: params.mode,
        source: params.source,
      })
    }

    if (params.conversationId?.trim()) {
      await releaseMaintenanceIntakePin(supabase, {
        landlordId,
        conversationId: params.conversationId,
        state: params.intake ?? null,
        runStatus: "cancelled",
        currentStep: "terminate_work_order",
        reason: params.source,
        lastResidentMessage: params.lastResidentMessage ?? null,
        eventMessage: "Intake closed because the work order was terminated.",
        clearDraftTicket: true,
      }).catch((e) => {
        console.warn("[terminate-wo] release intake pin", e)
      })
    }
  }

  await recordActivityLog(supabase, {
    landlordId,
    eventType:
      params.mode === "release"
        ? "maintenance.vendor_released"
        : params.mode === "archive"
          ? "maintenance.work_order_archived"
          : "maintenance.work_order_terminated",
    source:
      params.source === "resident_sms"
        ? "sms"
        : params.source === "automation" || params.source === "cleanup"
          ? "automation"
          : "dashboard",
    actorType:
      params.actorType === "resident"
        ? "resident"
        : params.actorType === "vendor"
          ? "vendor"
          : params.actorType === "system"
            ? "system"
            : "landlord",
    actorId: params.actorId ?? null,
    vendorId: assignedVendorId,
    maintenanceRequestId: ticketId,
    metadata: {
      mode: params.mode,
      terminate_source: params.source,
      reason,
      previous_status: currentStatus,
      previous_vendor_id: assignedVendorId,
      message:
        params.mode === "release"
          ? `${vendorName} was released from ${wo} (${sourceLabel(params.source)}).`
          : `${wo} was ${params.mode === "archive" ? "archived" : "cancelled"} (${sourceLabel(params.source)}).`,
    },
  }).catch(() => {})

  // 3) Delivery (independent SMS + email).
  let vendorNotify: TerminateWorkOrderResult extends { ok: true } ? TerminateWorkOrderResult["vendorNotify"] : never =
    "not_required"
  if (skipVendorNotifyCompleted && assignedVendorId && termination) {
    vendorNotify = "skipped"
    await alertStaffCompletedJobTerminated(supabase, {
      landlordId,
      ticketId,
      terminationId: termination.id as string,
      vendorId: assignedVendorId,
      vendorName,
      mode: params.mode,
      reason,
      previousStatus: currentStatus,
    })
  } else if (notifyWanted && smsBody && emailCopy && termination) {
    vendorNotify = await deliverVendorTerminateNotify(supabase, {
      termination: termination as TerminationRow,
      landlordId,
      ticketId,
      vendorId: assignedVendorId!,
      vendorPhone,
      vendorEmail,
      smsBody,
      emailCopy,
    })
  }

  if (warnPayment && (params.mode === "cancel" || params.mode === "archive")) {
    await warnLandlordPaymentObligation(supabase, {
      landlordId,
      ticketId,
      workOrderRef: wo,
      vendorName,
      previousStatus: currentStatus,
      hadApprovedEstimate,
      reason,
      terminationId: termination.id as string,
    })
  }

  return {
    ok: true,
    terminationId: termination.id as string,
    ticketId,
    mode: params.mode,
    previousVendorId: assignedVendorId,
    previousStatus: currentStatus || null,
    vendorNotify,
    landlordPaymentWarning: warnPayment,
  }
}

function mapNotifyStatus(
  raw: string | null | undefined,
): "notified" | "failed" | "skipped" | "not_required" | "pending" {
  switch (raw) {
    case "notified":
      return "notified"
    case "failed":
      return "failed"
    case "skipped":
      return "skipped"
    case "not_required":
      return "not_required"
    default:
      return "pending"
  }
}

async function deliverVendorTerminateNotify(
  supabase: SupabaseClient,
  params: {
    termination: TerminationRow
    landlordId: string
    ticketId: string
    vendorId: string
    vendorPhone: string | null
    vendorEmail: string | null
    smsBody: string
    emailCopy: { subject: string; text: string; html: string }
  },
): Promise<"notified" | "failed" | "skipped" | "pending"> {
  const { termination } = params
  let smsOk = false
  let emailOk = false
  let conversationId = termination.conversation_id

  // SMS
  if (!params.vendorPhone) {
    await recordTerminateAttempt(supabase, {
      terminationId: termination.id,
      ticketId: params.ticketId,
      landlordId: params.landlordId,
      channel: "sms",
      deliveryStatus: "skipped",
      failureReason: "no_vendor_phone",
      attemptNumber: (termination.sms_attempt_count || 0) + 1,
    })
  } else {
    const sender = await resolveVendorAlertSenderNumber(
      supabase,
      params.landlordId,
    )
    const attemptNumber = (termination.sms_attempt_count || 0) + 1
    let deliveryStatus: TerminateDeliveryStatus = "no_response"
    let failureReason: string | null = null
    let sid: string | null = null

    if (!sender) {
      deliveryStatus = "failed"
      failureReason = "no_sms_line"
    } else {
      try {
        const identity = await upsertSmsIdentityForPhone(supabase, {
          landlordId: params.landlordId,
          phone: params.vendorPhone,
          identityType: "vendor",
          vendorId: params.vendorId,
        })
        if (identity) {
          const created = await findOrCreateConversation(supabase, {
            landlordId: params.landlordId,
            smsNumberId: sender.id,
            externalPhone: params.vendorPhone,
            identity,
            maintenanceRequestId: params.ticketId,
            conversationStatus: "open",
          })
          conversationId = created.conversationId
        }

        const provider = getSMSProviderForSend({
          landlordId: params.landlordId,
          lineProvider: sender.provider,
        })
        const sendResult = await provider.sendMessage({
          to: params.vendorPhone,
          body: params.smsBody,
          from: sender.phone_number,
        })
        if (sendResult.error) {
          deliveryStatus = "failed"
          failureReason = sendResult.error
        } else {
          deliveryStatus = "sent"
          sid =
            sendResult.providerMessageSid ?? sendResult.messageId ?? null
          smsOk = true

          if (conversationId) {
            await supabase.from("sms_messages").insert({
              conversation_id: conversationId,
              landlord_id: params.landlordId,
              direction: "outbound",
              from_number: normalizeSmsPhone(sender.phone_number),
              to_number: normalizeSmsPhone(params.vendorPhone),
              body: params.smsBody,
              media_urls: [],
              provider: sender.provider ?? "twilio",
              provider_message_sid: sid ?? `terminate:${termination.id}`,
              provider_status: "sent",
              raw_payload: {
                source: TERMINATE_NOTIFY_SOURCE,
                termination_id: termination.id,
                ticket_id: params.ticketId,
              },
            }).then(({ error }) => {
              if (error) {
                console.warn("[terminate-wo] sms mirror", error.message)
              }
            })
          }
        }
      } catch (e) {
        deliveryStatus = "no_response"
        failureReason = e instanceof Error ? e.message : String(e)
      }
    }

    await recordTerminateAttempt(supabase, {
      terminationId: termination.id,
      ticketId: params.ticketId,
      landlordId: params.landlordId,
      channel: "sms",
      phone: params.vendorPhone,
      deliveryStatus,
      failureReason,
      providerMessageSid: sid,
      attemptNumber,
      conversationId,
    })

    await supabase
      .from("work_order_terminations")
      .update({
        sms_attempt_count: attemptNumber,
        last_sms_attempt_at: new Date().toISOString(),
        last_sms_error: deliveryStatus === "sent" ? null : failureReason,
        conversation_id: conversationId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", termination.id)
  }

  // Email (independent)
  if (!params.vendorEmail) {
    await recordTerminateAttempt(supabase, {
      terminationId: termination.id,
      ticketId: params.ticketId,
      landlordId: params.landlordId,
      channel: "email",
      deliveryStatus: "skipped",
      failureReason: "no_vendor_email",
      attemptNumber: (termination.email_attempt_count || 0) + 1,
      conversationId,
    })
  } else {
    const attemptNumber = (termination.email_attempt_count || 0) + 1
    let deliveryStatus: TerminateDeliveryStatus = "no_response"
    let failureReason: string | null = null
    try {
      const res = await sendResendEmail(
        params.vendorEmail,
        params.emailCopy.subject,
        params.emailCopy.text,
        params.emailCopy.html,
      )
      if (res.error) {
        deliveryStatus = "failed"
        failureReason = res.error
      } else {
        deliveryStatus = "sent"
        emailOk = true
      }
    } catch (e) {
      deliveryStatus = "failed"
      failureReason = e instanceof Error ? e.message : String(e)
    }

    await recordTerminateAttempt(supabase, {
      terminationId: termination.id,
      ticketId: params.ticketId,
      landlordId: params.landlordId,
      channel: "email",
      email: params.vendorEmail,
      deliveryStatus,
      failureReason,
      attemptNumber,
      conversationId,
    })

    await supabase
      .from("work_order_terminations")
      .update({
        email_attempt_count: attemptNumber,
        last_email_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", termination.id)
  }

  const anyOk = smsOk || emailOk
  const notifyStatus = anyOk
    ? "notified"
    : !params.vendorPhone && !params.vendorEmail
      ? "skipped"
      : "failed"

  await supabase
    .from("work_order_terminations")
    .update({
      notify_status: notifyStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", termination.id)

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: anyOk
      ? "maintenance.vendor_terminate_notified"
      : "maintenance.vendor_terminate_notify_failed",
    source: "automation",
    actorType: "system",
    vendorId: params.vendorId,
    maintenanceRequestId: params.ticketId,
    metadata: {
      termination_id: termination.id,
      message: anyOk
        ? `Vendor notified that ${formatWorkOrderRef(params.ticketId)} ended.`
        : `Vendor notification failed for ${formatWorkOrderRef(params.ticketId)}.`,
      sms_ok: smsOk,
      email_ok: emailOk,
    },
  }).catch(() => {})

  if (
    notifyStatus === "failed" &&
    (termination.sms_attempt_count || 0) + 1 >= MAX_TERMINATE_SMS_ATTEMPTS
  ) {
    await alertStaffTerminateNotifyExhausted(supabase, {
      landlordId: params.landlordId,
      ticketId: params.ticketId,
      terminationId: termination.id,
      vendorId: params.vendorId,
    })
  }

  return anyOk ? "notified" : notifyStatus === "skipped" ? "skipped" : "failed"
}

async function warnLandlordPaymentObligation(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    workOrderRef: string
    vendorName: string
    previousStatus: string
    hadApprovedEstimate: boolean
    reason: string | null
    terminationId: string
  },
): Promise<void> {
  const detail = params.hadApprovedEstimate
    ? "An estimate was already approved on this job."
    : `Work had already progressed (${params.previousStatus}).`
  const text = [
    `Ulo: ${params.workOrderRef} was cancelled after work may have started.`,
    "",
    detail,
    `Vendor: ${params.vendorName}`,
    params.reason ? `Reason: ${params.reason}` : null,
    "",
    "Please review whether any payment is owed to the vendor.",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    await sendLandlordOpsEmail(supabase, {
      landlordId: params.landlordId,
      subject: `Possible payment after cancelling ${params.workOrderRef}`,
      text,
      html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;">${text.replace(/</g, "&lt;")}</pre>`,
      logLabel: `terminate-payment-warn:${params.ticketId}`,
    })
    await supabase
      .from("work_order_terminations")
      .update({
        landlord_payment_warning_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.terminationId)
  } catch (e) {
    console.error("[terminate-wo] landlord payment warning", e)
  }

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.terminate_payment_warning",
    source: "automation",
    actorType: "system",
    maintenanceRequestId: params.ticketId,
    metadata: {
      message:
        `Possible payment obligation after cancelling ${params.workOrderRef} (${detail})`,
    },
  }).catch(() => {})
}

export async function alertStaffTerminateNotifyExhausted(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    terminationId: string
    vendorId: string
  },
): Promise<void> {
  const { data: row } = await supabase
    .from("work_order_terminations")
    .select("staff_alerted_at")
    .eq("id", params.terminationId)
    .maybeSingle()
  if (row?.staff_alerted_at) return

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.vendor_terminate_notify_exhausted",
    source: "automation",
    actorType: "system",
    vendorId: params.vendorId,
    maintenanceRequestId: params.ticketId,
    metadata: {
      termination_id: params.terminationId,
      message:
        `Could not notify the vendor that ${formatWorkOrderRef(params.ticketId)} ended after ${MAX_TERMINATE_SMS_ATTEMPTS} SMS tries. Check the vendor thread and email.`,
    },
  }).catch(() => {})

  await supabase
    .from("work_order_terminations")
    .update({
      staff_alerted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.terminationId)
}

/**
 * Cancelling a completed job is unusual — do not SMS the vendor; alert staff.
 */
export async function alertStaffCompletedJobTerminated(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    terminationId: string
    vendorId: string
    vendorName: string
    mode: TerminateMode
    reason: string | null
    previousStatus: string
  },
): Promise<void> {
  const wo = formatWorkOrderRef(params.ticketId)
  const text = [
    `Ulo: ${wo} was ${params.mode === "archive" ? "archived" : "cancelled"} after the vendor marked it completed.`,
    "",
    `Vendor: ${vendorCompanyName(params.vendorName)}`,
    `Prior status: ${params.previousStatus}`,
    params.reason ? `Internal reason: ${params.reason}` : null,
    "",
    "No cancel SMS was sent to the vendor. Please review whether follow-up is needed.",
  ]
    .filter(Boolean)
    .join("\n")

  try {
    await sendLandlordOpsEmail(supabase, {
      landlordId: params.landlordId,
      subject: `Review needed: ${wo} cancelled after completion`,
      text,
      html: `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;">${text.replace(/</g, "&lt;")}</pre>`,
      logLabel: `terminate-completed:${params.ticketId}`,
    })
  } catch (e) {
    console.error("[terminate-wo] completed-job staff email", e)
  }

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.terminate_completed_job_review",
    source: "automation",
    actorType: "system",
    vendorId: params.vendorId,
    maintenanceRequestId: params.ticketId,
    metadata: {
      termination_id: params.terminationId,
      previous_status: params.previousStatus,
      reason: params.reason,
      message:
        `${wo} was closed after completion — no vendor cancel SMS was sent. Staff should review.`,
    },
  }).catch(() => {})

  await supabase
    .from("work_order_terminations")
    .update({
      staff_alerted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.terminationId)
}

/** Retry failed terminate SMS under the attempt cap. */
export async function processWorkOrderTerminateNotifyRetries(
  supabase: SupabaseClient,
  options?: { landlordId?: string | null; now?: Date },
): Promise<{ retried: number; staffAlerts: number }> {
  const now = options?.now ?? new Date()
  let retried = 0
  let staffAlerts = 0

  let q = supabase
    .from("work_order_terminations")
    .select(
      "id, ticket_id, landlord_id, mode, previous_vendor_id, notify_status, sms_attempt_count, email_attempt_count, sms_body, staff_alerted_at, conversation_id, last_sms_error, reason, previous_vendor_work_status",
    )
    .in("notify_status", ["pending", "failed"])
    .lt("sms_attempt_count", MAX_TERMINATE_SMS_ATTEMPTS)
    .not("previous_vendor_id", "is", null)
    .limit(40)
  if (options?.landlordId?.trim()) {
    q = q.eq("landlord_id", options.landlordId.trim())
  }
  const { data: rows } = await q

  for (const row of rows ?? []) {
    const lastAt = row.last_sms_error
      ? // space by last attempt when available
        null
      : null
    void lastAt
    const { data: full } = await supabase
      .from("work_order_terminations")
      .select("last_sms_attempt_at")
      .eq("id", row.id)
      .maybeSingle()
    const lastAttempt = full?.last_sms_attempt_at
      ? new Date(String(full.last_sms_attempt_at)).getTime()
      : 0
    if (lastAttempt && now.getTime() - lastAttempt < 15 * 60_000) continue

    const vendorId = String(row.previous_vendor_id)
    const { data: vendor } = await supabase
      .from("vendors")
      .select("name, phone, email")
      .eq("id", vendorId)
      .maybeSingle()

    const smsBody =
      typeof row.sms_body === "string" && row.sms_body.trim()
        ? row.sms_body
        : buildVendorTerminateSms({
          vendorName:
            typeof vendor?.name === "string" ? vendor.name : "there",
          workOrderRef: formatWorkOrderRef(String(row.ticket_id)),
          propertyLabel: "",
          unit: "",
          reason: typeof row.reason === "string" ? row.reason : null,
          mode: (row.mode as TerminateMode) || "cancel",
          vendorWorkStatus:
            typeof row.previous_vendor_work_status === "string"
              ? row.previous_vendor_work_status
              : "accepted",
        })

    if (!smsBody) {
      // Completed-at-cancel rows should not retry vendor SMS.
      continue
    }

    const emailCopy = buildVendorTerminateEmail({
      vendorName: typeof vendor?.name === "string" ? vendor.name : "there",
      workOrderRef: formatWorkOrderRef(String(row.ticket_id)),
      propertyLabel: "",
      unit: "",
      reason: typeof row.reason === "string" ? row.reason : null,
      mode: (row.mode as TerminateMode) || "cancel",
      vendorWorkStatus:
        typeof row.previous_vendor_work_status === "string"
          ? row.previous_vendor_work_status
          : "accepted",
    })
    if (!emailCopy) continue

    const result = await deliverVendorTerminateNotify(supabase, {
      termination: row as TerminationRow,
      landlordId: row.landlord_id as string,
      ticketId: row.ticket_id as string,
      vendorId,
      vendorPhone:
        typeof vendor?.phone === "string" ? vendor.phone.trim() : null,
      vendorEmail:
        typeof vendor?.email === "string" ? vendor.email.trim() : null,
      smsBody,
      emailCopy,
    })
    retried += 1

    if (
      result === "failed" &&
      (Number(row.sms_attempt_count) || 0) + 1 >= MAX_TERMINATE_SMS_ATTEMPTS &&
      !row.staff_alerted_at
    ) {
      await alertStaffTerminateNotifyExhausted(supabase, {
        landlordId: row.landlord_id as string,
        ticketId: row.ticket_id as string,
        terminationId: row.id as string,
        vendorId,
      })
      staffAlerts += 1
    }
  }

  return { retried, staffAlerts }
}
