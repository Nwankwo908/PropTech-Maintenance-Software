/**
 * Vendor job dispatch → accept → earliest availability → schedule confirm (Phase 1 / 4.1).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "./graph/logGraphEvent.ts"
import { sendResendEmail } from "./delivery.ts"
import {
  notifyResident,
  type ResidentNotifyInput,
} from "./resident_notify.ts"
import { resolveLandlordId } from "./sms/landlordSmsOnboarding.ts"
import { sendVendorJobAlert } from "./sms/vendorSmsRouting.ts"
import {
  buildVendorAvailabilityAskSms,
  buildVendorJobDetailLinkSms,
  buildVendorScheduleConfirmedSms,
  formatWorkOrderRef,
} from "./vendor_outreach_copy.ts"
import {
  parseAvailabilityToScheduledAt,
  type ResolvedAvailability,
} from "./vendor_availability_parse.ts"
import {
  appendOutboundContext,
  CONFIRM_TTL_MS,
  createIdleScheduleState,
  persistVendorScheduleFsm,
  readVendorScheduleFsm,
  reduceScheduleFsm,
  SCHEDULE_TTL_MS,
  type VendorScheduleFsmState,
  type VendorScheduleStep,
  withVendorScheduleFsm,
} from "./vendor_schedule_fsm.ts"

export { parseAvailabilityToScheduledAt } from "./vendor_availability_parse.ts"
export type { VendorScheduleFsmState, VendorScheduleStep }

function appBaseUrl(): string {
  const raw = Deno.env.get("APP_URL")?.trim() ?? ""
  if (!raw) return ""
  const t = raw.replace(/\/$/, "")
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

/** @deprecated Prefer VendorScheduleFsmState — kept for older call sites. */
export type VendorScheduleState = {
  step?: VendorScheduleStep
  ticketId?: string
  pendingWindowText?: string
  pendingScheduledAt?: string | null
  pendingEndAt?: string | null
  revision?: number
  expiresAt?: string
}

export function formatWorkOrderRefFromTicketId(ticketId: string): string {
  return formatWorkOrderRef(ticketId)
}

export function readVendorScheduleState(
  intakeState: Record<string, unknown> | null | undefined,
): VendorScheduleState | null {
  const fsm = readVendorScheduleFsm(intakeState)
  if (!fsm || fsm.step === "idle") return null
  return {
    step: fsm.step,
    ticketId: fsm.ticketId,
    pendingWindowText: fsm.pendingWindowText,
    pendingScheduledAt: fsm.pendingScheduledAt,
    pendingEndAt: fsm.pendingEndAt,
    revision: fsm.revision,
    expiresAt: fsm.expiresAt,
  }
}

export function withVendorScheduleState(
  intakeState: Record<string, unknown> | null | undefined,
  schedule: VendorScheduleState | null,
): Record<string, unknown> {
  if (!schedule) {
    return withVendorScheduleFsm(intakeState, null)
  }
  const prev = readVendorScheduleFsm(intakeState) ??
    createIdleScheduleState(schedule.ticketId ?? "")
  const at = new Date().toISOString()
  const step = schedule.step && schedule.step !== "idle"
    ? schedule.step
    : "awaiting_availability"
  const next: VendorScheduleFsmState = {
    ...prev,
    step,
    ticketId: schedule.ticketId ?? prev.ticketId,
    pendingWindowText: schedule.pendingWindowText,
    pendingScheduledAt: schedule.pendingScheduledAt,
    pendingEndAt: schedule.pendingEndAt,
    enteredAt: at,
    expiresAt: schedule.expiresAt ??
      new Date(
        Date.now() +
          (step === "awaiting_confirmation" ? CONFIRM_TTL_MS : SCHEDULE_TTL_MS),
      ).toISOString(),
    revision: prev.revision + 1,
  }
  return withVendorScheduleFsm(intakeState, next)
}

export async function setVendorPendingConfirmation(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    ticketId: string
    pending: ResolvedAvailability
  },
): Promise<void> {
  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()

  const intake = (convo?.intake_state as Record<string, unknown> | null) ?? {}
  const prev = readVendorScheduleFsm(intake)
  const at = new Date().toISOString()
  const transition = reduceScheduleFsm(prev, {
    type: "SAVE_FAIL",
    at,
    windowText: params.pending.windowLabel,
    scheduledAt: params.pending.scheduledAt,
    endAt: params.pending.endAt,
  })
  // SAVE_FAIL enters awaiting_confirmation with pending — reuse for soft confirm too.
  const next: VendorScheduleFsmState = {
    ...transition.state,
    ticketId: params.ticketId,
    step: "awaiting_confirmation",
    pendingWindowText: params.pending.windowLabel,
    pendingScheduledAt: params.pending.scheduledAt,
    pendingEndAt: params.pending.endAt,
    pendingSince: at,
  }
  await persistVendorScheduleFsm(supabase, {
    conversationId: params.conversationId,
    ticketId: params.ticketId,
    next,
    expectedRevision: prev?.revision,
  })
}

async function loadVendorConversationId(
  supabase: SupabaseClient,
  params: { vendorId: string; ticketId: string },
): Promise<string | null> {
  const { data } = await supabase
    .from("sms_conversations")
    .select("id")
    .eq("vendor_id", params.vendorId)
    .eq("maintenance_request_id", params.ticketId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data?.id) return data.id as string

  const { data: byVendor } = await supabase
    .from("sms_conversations")
    .select("id")
    .eq("vendor_id", params.vendorId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (byVendor?.id as string | undefined) ?? null
}

export async function setVendorAwaitingAvailability(
  supabase: SupabaseClient,
  params: { conversationId: string; ticketId: string },
): Promise<void> {
  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()

  const intake = (convo?.intake_state as Record<string, unknown> | null) ?? {}
  const prev = readVendorScheduleFsm(intake)
  const at = new Date().toISOString()
  const transition = reduceScheduleFsm(prev, {
    type: "JOB_ACCEPTED",
    ticketId: params.ticketId,
    at,
  })
  await persistVendorScheduleFsm(supabase, {
    conversationId: params.conversationId,
    ticketId: params.ticketId,
    next: transition.state,
    expectedRevision: prev?.revision,
  })
}

/**
 * After accept (SMS or email): ask earliest availability over SMS when possible.
 * Does not notify resident/landlord.
 */
export async function beginVendorAvailabilityAsk(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    conversationId?: string | null
  },
): Promise<{ sentSms: boolean; conversationId: string | null }> {
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, name, phone")
    .eq("id", params.vendorId)
    .maybeSingle()

  const phone =
    typeof vendor?.phone === "string" ? vendor.phone.trim() : ""
  if (!phone) {
    return { sentSms: false, conversationId: params.conversationId ?? null }
  }

  // SMS 2 — scheduling ask (must use the ticket's landlord SMS line)
  const body = buildVendorAvailabilityAskSms()
  const { data: ticketRow } = await supabase
    .from("maintenance_requests")
    .select("landlord_id")
    .eq("id", params.ticketId)
    .maybeSingle()
  const landlordId =
    typeof ticketRow?.landlord_id === "string"
      ? ticketRow.landlord_id.trim()
      : null

  const send = await sendVendorJobAlert(supabase, {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
    vendorPhone: phone,
    body,
    landlordId,
  })
  if (!send.ok) {
    console.error("[vendor-schedule] availability ask SMS failed", {
      ticketId: params.ticketId,
      vendorId: params.vendorId,
      landlordId,
      error: send.error,
    })
  }

  let conversationId = params.conversationId ?? null
  if (send.ok) {
    conversationId = send.conversationId
  } else if (!conversationId) {
    conversationId = await loadVendorConversationId(supabase, {
      vendorId: params.vendorId,
      ticketId: params.ticketId,
    })
  }

  if (conversationId) {
    const { data: convo } = await supabase
      .from("sms_conversations")
      .select("intake_state")
      .eq("id", conversationId)
      .maybeSingle()
    const intake = (convo?.intake_state as Record<string, unknown> | null) ?? {}
    const prev = readVendorScheduleFsm(intake)
    const at = new Date().toISOString()
    let transition = reduceScheduleFsm(prev, {
      type: "JOB_ACCEPTED",
      ticketId: params.ticketId,
      at,
    })
    if (send.ok) {
      transition = {
        ...transition,
        state: appendOutboundContext(transition.state, body, at),
      }
    }
    await persistVendorScheduleFsm(supabase, {
      conversationId,
      ticketId: params.ticketId,
      next: transition.state,
      expectedRevision: prev?.revision,
    })
  }

  // Job detail / estimate link is sent after schedule lock (see confirmVendorSchedule).
  return { sentSms: send.ok, conversationId }
}

async function resolveVendorJobDetailUrl(
  supabase: SupabaseClient,
  ticketId: string,
): Promise<string> {
  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("vendor_action_token")
    .eq("id", ticketId)
    .maybeSingle()
  const token =
    typeof ticket?.vendor_action_token === "string"
      ? ticket.vendor_action_token.trim()
      : ""
  if (!token) return ""
  const base = appBaseUrl()
  return base
    ? `${base}/w/${encodeURIComponent(token)}`
    : `/w/${encodeURIComponent(token)}`
}

function adminNotifyEmails(): string[] {
  const raw = Deno.env.get("SMS_ADMIN_NOTIFY_EMAILS")?.trim()
  if (!raw) return []
  return raw
    .split(/[,;\s]+/)
    .map((e: string) => e.trim())
    .filter((e: string) => e.includes("@"))
}

async function notifyLandlordScheduleConfirmed(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    ticketId: string
    workOrderRef: string
    unit: string
    windowText: string
    vendorName: string
  },
): Promise<void> {
  const emails = new Set(adminNotifyEmails())
  const { data: landlord } = await supabase
    .from("landlords")
    .select("email")
    .eq("id", params.landlordId)
    .maybeSingle()
  if (typeof landlord?.email === "string" && landlord.email.includes("@")) {
    emails.add(landlord.email.trim())
  }

  const subject = `Job ${params.workOrderRef} scheduled`
  const text = [
    `A vendor confirmed an appointment.`,
    "",
    `Job: ${params.workOrderRef}`,
    `Unit: ${params.unit || "—"}`,
    `Vendor: ${params.vendorName || "—"}`,
    `When: ${params.windowText}`,
    `Ticket: ${params.ticketId}`,
    "",
    "Review the work order in the admin dashboard.",
  ].join("\n")

  for (const email of emails) {
    const result = await sendResendEmail(
      email,
      subject,
      text,
      `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap;">${text}</pre>`,
    )
    if ("error" in result) {
      console.error("[vendor-schedule] landlord email", email, result.error)
    }
  }
}

/**
 * Persist schedule, confirm to vendor, notify tenant + landlord.
 */
export async function confirmVendorSchedule(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    conversationId?: string | null
    windowText: string
    /** Pre-resolved start instant (from chrono/LLM). */
    scheduledAt?: string | null
  },
): Promise<{ ok: true; replyHint: string } | { ok: false; error: string }> {
  const windowText = params.windowText.trim().replace(/\s+/g, " ")
  if (!windowText) {
    return { ok: false, error: "empty_window" }
  }

  const scheduledAt =
    (typeof params.scheduledAt === "string" && params.scheduledAt.trim()
      ? params.scheduledAt.trim()
      : null) ?? parseAvailabilityToScheduledAt(windowText)
  const nowIso = new Date().toISOString()

  const { data: ticket, error: tErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, unit, resident_name, email, resident_phone, resident_notification_channel, priority, assigned_vendor_id, vendor_work_status, vendor_action_token",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  if (tErr || !ticket) {
    console.error("[vendor-schedule] ticket lookup", tErr?.message)
    return { ok: false, error: "ticket_not_found" }
  }
  // Soft check: still save availability when the vendor is texting on the job
  // thread even if assigned_vendor_id drifted (reassign race / duplicate profiles).
  if (
    ticket.assigned_vendor_id &&
    ticket.assigned_vendor_id !== params.vendorId
  ) {
    console.warn("[vendor-schedule] assigned vendor mismatch; saving anyway", {
      ticketId: params.ticketId,
      assigned: ticket.assigned_vendor_id,
      replier: params.vendorId,
    })
  }

  const patch: Record<string, unknown> = {
    scheduled_window_text: windowText,
    scheduled_at: scheduledAt,
    schedule_confirmed_at: nowIso,
  }
  if (ticket.vendor_work_status === "pending_accept") {
    patch.vendor_work_status = "accepted"
  }

  const { error: upErr } = await supabase
    .from("maintenance_requests")
    .update(patch)
    .eq("id", params.ticketId)

  if (upErr) {
    console.error("[vendor-schedule] update ticket", upErr.message, upErr)
    // Retry without parsed timestamp — window text is the source of truth.
    const { error: retryErr } = await supabase
      .from("maintenance_requests")
      .update({
        scheduled_window_text: windowText,
        schedule_confirmed_at: nowIso,
      })
      .eq("id", params.ticketId)
    if (retryErr) {
      console.error("[vendor-schedule] update retry", retryErr.message)
      return { ok: false, error: `update_failed:${retryErr.message}` }
    }
  }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("name, phone")
    .eq("id", params.vendorId)
    .maybeSingle()

  const vendorName =
    typeof vendor?.name === "string" ? vendor.name.trim() : "Vendor"
  const vendorPhone =
    typeof vendor?.phone === "string" ? vendor.phone.trim() : ""
  const workOrderRef = formatWorkOrderRef(params.ticketId)
  const unit = typeof ticket.unit === "string" ? ticket.unit : ""

  let jobDetailUrl = ""
  try {
    jobDetailUrl = await resolveVendorJobDetailUrl(supabase, params.ticketId)
  } catch (e) {
    console.error("[vendor-schedule] resolve job detail url", e)
  }

  // Completes the scheduling interaction: confirm + clear next action (estimate).
  const replyHint = buildVendorScheduleConfirmedSms({
    workOrderRef,
    windowText,
    jobDetailUrl,
  })

  if (params.conversationId) {
    const { data: convo } = await supabase
      .from("sms_conversations")
      .select("intake_state")
      .eq("id", params.conversationId)
      .maybeSingle()
    const intake = (convo?.intake_state as Record<string, unknown> | null) ?? {}
    const prev = readVendorScheduleFsm(intake)
    const transition = reduceScheduleFsm(prev, {
      type: "SAVE_OK",
      at: nowIso,
      windowText,
    })
    const withOut = appendOutboundContext(transition.state, replyHint, nowIso)
    // No expectedRevision — caller may have already bumped the FSM this turn.
    await persistVendorScheduleFsm(supabase, {
      conversationId: params.conversationId,
      ticketId: params.ticketId,
      next: { ...withOut, ticketId: params.ticketId },
    })
  }

  // Fallback follow-up if we confirmed without a portal link in the reply.
  if (!jobDetailUrl && vendorPhone) {
    try {
      const url = await resolveVendorJobDetailUrl(supabase, params.ticketId)
      const linkSms = url ? buildVendorJobDetailLinkSms(url) : ""
      if (linkSms) {
        const linkLandlordId =
          (typeof ticket.landlord_id === "string" && ticket.landlord_id.trim()) ||
          null
        await sendVendorJobAlert(supabase, {
          ticketId: params.ticketId,
          vendorId: params.vendorId,
          vendorPhone,
          body: linkSms,
          landlordId: linkLandlordId,
        })
      }
    } catch (e) {
      console.error("[vendor-schedule] post-confirm next-steps SMS", e)
    }
  }

  const residentInput: ResidentNotifyInput = {
    event: "schedule_confirmed",
    ticketId: params.ticketId,
    recipientName: String(ticket.resident_name ?? ""),
    recipientEmail: typeof ticket.email === "string" ? ticket.email.trim() : "",
    recipientPhone:
      typeof ticket.resident_phone === "string" ? ticket.resident_phone : null,
    notificationChannel:
      typeof ticket.resident_notification_channel === "string"
        ? ticket.resident_notification_channel
        : null,
    unit: unit || undefined,
    priority: typeof ticket.priority === "string" ? ticket.priority : undefined,
    vendorName,
    scheduleWindow: windowText,
  }
  try {
    await notifyResident(supabase, residentInput)
  } catch (e) {
    console.error("[vendor-schedule] resident notify", e)
  }

  const landlordId =
    (typeof ticket.landlord_id === "string" && ticket.landlord_id.trim()) ||
    resolveLandlordId()
  try {
    await notifyLandlordScheduleConfirmed(supabase, {
      landlordId,
      ticketId: params.ticketId,
      workOrderRef,
      unit,
      windowText,
      vendorName,
    })
  } catch (e) {
    console.error("[vendor-schedule] landlord notify", e)
  }

  try {
    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "maintenance.schedule_confirmed",
      source: "sms",
      actor_type: "vendor",
      actor_id: params.vendorId,
      vendor_id: params.vendorId,
      maintenance_request_id: params.ticketId,
      conversation_id: params.conversationId ?? null,
      metadata: {
        scheduled_window_text: windowText,
        scheduled_at: scheduledAt,
        work_order_ref: workOrderRef,
      },
    })
  } catch (e) {
    console.error("[vendor-schedule] graph event", e)
  }

  return { ok: true, replyHint }
}
