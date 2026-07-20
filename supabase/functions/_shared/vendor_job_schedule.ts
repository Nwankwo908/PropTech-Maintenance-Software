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
  buildVendorScheduleConfirmedSms,
  formatWorkOrderRef,
} from "./vendor_outreach_copy.ts"

export type VendorScheduleStep = "awaiting_availability" | "scheduled"

export type VendorScheduleState = {
  step?: VendorScheduleStep
  ticketId?: string
}

const SCHEDULE_KEY = "vendor_schedule"

export function formatWorkOrderRefFromTicketId(ticketId: string): string {
  return formatWorkOrderRef(ticketId)
}

export function readVendorScheduleState(
  intakeState: Record<string, unknown> | null | undefined,
): VendorScheduleState | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = intakeState[SCHEDULE_KEY]
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const step = obj.step
  const ticketId = typeof obj.ticketId === "string" ? obj.ticketId : undefined
  if (step === "awaiting_availability" || step === "scheduled") {
    return { step, ticketId }
  }
  return null
}

export function withVendorScheduleState(
  intakeState: Record<string, unknown> | null | undefined,
  schedule: VendorScheduleState | null,
): Record<string, unknown> {
  const base =
    intakeState && typeof intakeState === "object" ? { ...intakeState } : {}
  if (!schedule) {
    delete base[SCHEDULE_KEY]
    return base
  }
  base[SCHEDULE_KEY] = schedule
  return base
}

/** Best-effort parse of vendor availability into an ISO timestamp (null if unclear). */
export function parseAvailabilityToScheduledAt(
  raw: string,
  now = new Date(),
): string | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, " ")
  if (!text) return null

  const timeMatch = text.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i,
  )
  let hours: number | null = null
  let minutes = 0
  if (timeMatch) {
    hours = Number(timeMatch[1])
    minutes = timeMatch[2] ? Number(timeMatch[2]) : 0
    const meridiem = (timeMatch[3] ?? "").toLowerCase().replace(/\./g, "")
    if (meridiem.startsWith("p") && hours < 12) hours += 12
    if (meridiem.startsWith("a") && hours === 12) hours = 0
  } else {
    const military = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)
    if (military) {
      hours = Number(military[1])
      minutes = Number(military[2])
    }
  }

  const base = new Date(now.getTime())
  if (/\btomorrow\b/.test(text)) {
    base.setDate(base.getDate() + 1)
  } else if (/\btoday\b/.test(text)) {
    // keep today
  } else if (hours == null) {
    return null
  }

  if (hours == null) hours = 10
  base.setHours(hours, minutes, 0, 0)
  if (Number.isNaN(base.getTime())) return null
  return base.toISOString()
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

  const next = withVendorScheduleState(
    (convo?.intake_state as Record<string, unknown> | null) ?? {},
    { step: "awaiting_availability", ticketId: params.ticketId },
  )

  await supabase
    .from("sms_conversations")
    .update({
      intake_state: next,
      maintenance_request_id: params.ticketId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.conversationId)
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

  const body = buildVendorAvailabilityAskSms()
  const send = await sendVendorJobAlert(supabase, {
    ticketId: params.ticketId,
    vendorId: params.vendorId,
    vendorPhone: phone,
    body,
  })

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
    await setVendorAwaitingAvailability(supabase, {
      conversationId,
      ticketId: params.ticketId,
    })
  }

  return { sentSms: send.ok, conversationId }
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
  },
): Promise<{ ok: true; replyHint: string } | { ok: false; error: string }> {
  const windowText = params.windowText.trim().replace(/\s+/g, " ")
  if (!windowText) {
    return { ok: false, error: "empty_window" }
  }

  const scheduledAt = parseAvailabilityToScheduledAt(windowText)
  const nowIso = new Date().toISOString()

  const { data: ticket, error: tErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, unit, resident_name, email, resident_phone, resident_notification_channel, priority, assigned_vendor_id, vendor_work_status",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  if (tErr || !ticket) {
    return { ok: false, error: "ticket_not_found" }
  }
  if (ticket.assigned_vendor_id !== params.vendorId) {
    return { ok: false, error: "not_assigned_to_vendor" }
  }

  const { error: upErr } = await supabase
    .from("maintenance_requests")
    .update({
      scheduled_window_text: windowText,
      scheduled_at: scheduledAt,
      schedule_confirmed_at: nowIso,
      vendor_work_status:
        ticket.vendor_work_status === "pending_accept"
          ? "accepted"
          : ticket.vendor_work_status,
    })
    .eq("id", params.ticketId)

  if (upErr) {
    console.error("[vendor-schedule] update ticket", upErr.message)
    return { ok: false, error: "update_failed" }
  }

  if (params.conversationId) {
    const { data: convo } = await supabase
      .from("sms_conversations")
      .select("intake_state")
      .eq("id", params.conversationId)
      .maybeSingle()
    const next = withVendorScheduleState(
      (convo?.intake_state as Record<string, unknown> | null) ?? {},
      { step: "scheduled", ticketId: params.ticketId },
    )
    await supabase
      .from("sms_conversations")
      .update({ intake_state: next, updated_at: nowIso })
      .eq("id", params.conversationId)
  }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("name, phone")
    .eq("id", params.vendorId)
    .maybeSingle()

  const vendorName =
    typeof vendor?.name === "string" ? vendor.name.trim() : "Vendor"
  const workOrderRef = formatWorkOrderRef(params.ticketId)
  const unit = typeof ticket.unit === "string" ? ticket.unit : ""
  // Caller (SMS workflow) sends this as the outbound reply.
  const replyHint = buildVendorScheduleConfirmedSms({
    workOrderRef,
    windowText,
  })

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
