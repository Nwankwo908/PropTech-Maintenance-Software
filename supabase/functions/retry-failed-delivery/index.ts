import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  notifyResident,
  type ResidentNotifyEvent,
  normalizePhoneFlexible,
} from "../_shared/resident_notify.ts"
import { sendResendEmail } from "../_shared/delivery.ts"
import { sendOutboundSms } from "../_shared/sms/adapters.ts"
import { serveRetryFailedDelivery } from "../_shared/retryFailedDeliveryEdge.ts"
import type { DeliveryLog } from "../_shared/retryFailedDelivery.ts"
import {
  buildVendorRetryEmailSubject,
  buildVendorRetryEmailText,
  buildVendorRetrySms,
} from "../_shared/vendor_outreach_copy.ts"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function isReservedTestEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? "").trim().toLowerCase()
  const at = normalized.lastIndexOf("@")
  if (at <= 0) return false
  const domain = normalized.slice(at + 1)
  return domain === "example.com" || domain.endsWith(".example.com")
}

/** NANP 555-0100 through 555-0199 cannot receive SMS. */
function isFictionalTestPhone(phone: string | null | undefined): boolean {
  const digits = (phone ?? "").replace(/\D/g, "")
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (national.length !== 10) return false
  const line = national.slice(6)
  return national.slice(3, 6) === "555" && line >= "0100" && line <= "0199"
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

type RetryChannel = "email" | "sms"

function isResidentEventType(value: string): value is ResidentNotifyEvent {
  return (
    value === "ticket_submitted" ||
    value === "vendor_assigned" ||
    value === "vendor_accepted" ||
    value === "schedule_confirmed" ||
    value === "repair_in_progress" ||
    value === "repair_completed"
  )
}

function vendorRetryEmailBodies(input: {
  ticketId: string
  vendorName: string
  priority: string
  unit: string
  description: string
}): { subject: string; text: string; html: string } {
  const subject = buildVendorRetryEmailSubject(input.ticketId)
  const text = buildVendorRetryEmailText(input)
  const first = input.vendorName.trim().split(/\s+/)[0] || "there"
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #101828;">
  <p>Hi ${escapeHtml(first)},</p>
  <p>We're resending your job alert — our last message may not have gone through.</p>
  <p><strong>Priority:</strong> ${escapeHtml(input.priority)}</p>
  <p><strong>Location:</strong> ${escapeHtml(input.unit)}</p>
  <p style="color:#6a7282;">What's needed</p>
  <p style="white-space: pre-wrap;">${escapeHtml(input.description)}</p>
  <p style="font-size:12px;color:#6a7282;">Job ref: ${escapeHtml(input.ticketId)}</p>
  <p>Check your email or vendor portal for accept/decline links.</p>
  <p>Thanks!</p>
</body>
</html>`.trim()
  return { subject, text, html }
}

function vendorRetrySmsBody(input: {
  ticketId: string
  priority: string
  unit: string
}): string {
  return buildVendorRetrySms(input)
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

async function retryResidentDelivery(
  supabase: SupabaseClient,
  logId: string,
  channel: RetryChannel,
): Promise<{ ok: true }> {
  const { data, error } = await supabase
    .from("resident_notification_log")
    .select(
      "id, ticket_id, event_type, vendor_name, maintenance_requests(resident_name, email, resident_phone, unit, priority, urgency, description, resident_notification_channel)",
    )
    .eq("id", logId)
    .maybeSingle()

  if (error) {
    console.error("[retry-failed-delivery] resident log lookup", error)
    throw new Error("Resident retry lookup failed")
  }
  if (!data) throw new Error("Resident retry log not found")

  const eventTypeRaw = String(data.event_type ?? "").trim().toLowerCase()
  if (!isResidentEventType(eventTypeRaw)) {
    throw new Error(`Unsupported resident event type: ${eventTypeRaw || "unknown"}`)
  }

  const ticket = Array.isArray(data.maintenance_requests)
    ? data.maintenance_requests[0]
    : data.maintenance_requests
  if (!ticket) throw new Error("Ticket details unavailable for resident retry")

  const priority =
    (typeof ticket.urgency === "string" && ticket.urgency.trim()
      ? ticket.urgency
      : ticket.priority) || "normal"
  const residentEmail = typeof ticket.email === "string" ? ticket.email.trim() : ""
  const residentPhone = typeof ticket.resident_phone === "string" ? ticket.resident_phone : ""
  if (
    (channel === "email" && isReservedTestEmail(residentEmail)) ||
    (channel === "sms" && isFictionalTestPhone(residentPhone))
  ) {
    console.info("[retry-failed-delivery] dry-run reserved recipient")
    return { ok: true }
  }

  await notifyResident(supabase, {
    event: eventTypeRaw,
    ticketId: String(data.ticket_id),
    recipientName: String(ticket.resident_name ?? ""),
    recipientEmail: residentEmail,
    recipientPhone: residentPhone || null,
    notificationChannel: channel,
    unit: typeof ticket.unit === "string" ? ticket.unit : undefined,
    priority: String(priority),
    descriptionPreview:
      typeof ticket.description === "string" ? ticket.description : undefined,
    vendorName:
      typeof data.vendor_name === "string" ? data.vendor_name : undefined,
  })

  return { ok: true }
}

async function retryVendorDelivery(
  supabase: SupabaseClient,
  logId: string,
  channel: RetryChannel,
): Promise<{ ok: true }> {
  const { data, error } = await supabase
    .from("vendor_notification_log")
    .select(
      "id, ticket_id, vendor_id, vendors(name, email, phone), maintenance_requests(priority, urgency, unit, description)",
    )
    .eq("id", logId)
    .maybeSingle()

  if (error) {
    console.error("[retry-failed-delivery] vendor log lookup", error)
    throw new Error("Vendor retry lookup failed")
  }
  if (!data) throw new Error("Vendor retry log not found")

  const vendor = Array.isArray(data.vendors) ? data.vendors[0] : data.vendors
  const ticket = Array.isArray(data.maintenance_requests)
    ? data.maintenance_requests[0]
    : data.maintenance_requests
  if (!vendor || !ticket) throw new Error("Vendor or ticket data missing for retry")

  const vendorName =
    typeof vendor.name === "string" && vendor.name.trim()
      ? vendor.name.trim()
      : "Vendor"
  const ticketId = String(data.ticket_id)
  const priority =
    (typeof ticket.urgency === "string" && ticket.urgency.trim()
      ? ticket.urgency
      : ticket.priority) || "normal"
  const unit = typeof ticket.unit === "string" ? ticket.unit : "N/A"
  const description =
    typeof ticket.description === "string" ? ticket.description : ""

  let providerMessageId: string | null = null
  let sendErr: string | null = null

  if (channel === "email") {
    const to = typeof vendor.email === "string" ? vendor.email.trim() : ""
    if (!to) throw new Error("Vendor has no email for retry")
    if (isReservedTestEmail(to)) {
      console.info("[retry-failed-delivery] dry-run reserved recipient")
      return { ok: true }
    }
    const email = vendorRetryEmailBodies({
      ticketId,
      vendorName,
      priority: String(priority),
      unit,
      description,
    })
    const result = await sendResendEmail(to, email.subject, email.text, email.html)
    if ("error" in result) sendErr = result.error
    else providerMessageId = result.id
  } else {
    const to = normalizePhoneFlexible(
      typeof vendor.phone === "string" ? vendor.phone : null,
    )
    if (!to) throw new Error("Vendor has no valid phone for SMS retry")
    if (isFictionalTestPhone(to)) {
      console.info("[retry-failed-delivery] dry-run reserved recipient")
      return { ok: true }
    }
    const result = await sendOutboundSms(
      to,
      vendorRetrySmsBody({ ticketId, priority: String(priority), unit }),
    )
    if ("error" in result) sendErr = result.error
    else providerMessageId = result.sid
  }

  const { error: insErr } = await supabase.from("vendor_notification_log").insert({
    ticket_id: ticketId,
    vendor_id: data.vendor_id,
    channel,
    provider_message_id: providerMessageId,
    error: sendErr,
  })
  if (insErr) {
    console.error("[retry-failed-delivery] vendor retry log insert", insErr)
  }

  if (sendErr) throw new Error(sendErr)
  return { ok: true }
}

async function retryBroadcastDelivery(
  supabase: SupabaseClient,
  logId: string,
  channel: RetryChannel,
): Promise<{ ok: true }> {
  const { data, error } = await supabase
    .from("broadcast_notification_log")
    .select(
      "id, broadcast_id, recipient_user_id, recipient_email, channel, broadcast_notifications(subject, message)",
    )
    .eq("id", logId)
    .maybeSingle()

  if (error) {
    console.error("[retry-failed-delivery] broadcast log lookup", error)
    throw new Error("Broadcast retry lookup failed")
  }
  if (!data) throw new Error("Broadcast retry log not found")

  const parent = Array.isArray(data.broadcast_notifications)
    ? data.broadcast_notifications[0]
    : data.broadcast_notifications
  const subject =
    (typeof parent?.subject === "string" && parent.subject.trim()) ||
    "Broadcast"
  const message =
    (typeof parent?.message === "string" && parent.message.trim()) || ""

  let recipientEmail =
    typeof data.recipient_email === "string" ? data.recipient_email.trim() : ""
  let recipientPhone: string | null = null
  const recipientUserId =
    typeof data.recipient_user_id === "string" ? data.recipient_user_id : null

  if (recipientUserId) {
    const { data: user } = await supabase
      .from("users")
      .select("email, phone")
      .eq("id", recipientUserId)
      .maybeSingle()
    if (!recipientEmail && typeof user?.email === "string") {
      recipientEmail = user.email.trim()
    }
    recipientPhone = normalizePhoneFlexible(
      typeof user?.phone === "string" ? user.phone : null,
    )
  }

  let providerMessageId: string | null = null
  let sendErr: string | null = null

  if (channel === "email") {
    if (!recipientEmail) throw new Error("Broadcast recipient email missing for retry")
    if (isReservedTestEmail(recipientEmail)) {
      console.info("[retry-failed-delivery] dry-run reserved recipient")
      return { ok: true }
    }
    const html = `
<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#101828;">
<p>${escapeHtml(message || "Broadcast message")}</p>
</body></html>`.trim()
    const result = await sendResendEmail(recipientEmail, subject, message || subject, html)
    if ("error" in result) sendErr = result.error
    else providerMessageId = result.id
  } else {
    if (!recipientPhone) throw new Error("Broadcast recipient phone missing for SMS retry")
    if (isFictionalTestPhone(recipientPhone)) {
      console.info("[retry-failed-delivery] dry-run reserved recipient")
      return { ok: true }
    }
    const result = await sendOutboundSms(recipientPhone, message || subject)
    if ("error" in result) sendErr = result.error
    else providerMessageId = result.sid
  }

  const { error: insErr } = await supabase.from("broadcast_notification_log").insert({
    broadcast_id: data.broadcast_id,
    recipient_user_id: recipientUserId,
    recipient_email: recipientEmail || null,
    channel,
    success: !sendErr,
    error: sendErr,
    provider_message_id: providerMessageId,
  })
  if (insErr) {
    console.error("[retry-failed-delivery] broadcast retry log insert", insErr)
  }

  if (sendErr) throw new Error(sendErr)
  return { ok: true }
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim()
  const internalKey = Deno.env.get("ULO_INTERNAL_KEY")?.trim()
  if (!supabaseUrl || !serviceKey || !anonKey || !internalKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }
  const supabase = createClient(supabaseUrl, serviceKey)
  return serveRetryFailedDelivery(
    req,
    supabase,
    { supabaseUrl, anonKey, internalKey },
    async (entry) => {
      await sendRetry(supabase, entry)
    },
  )
})

async function sendRetry(supabase: SupabaseClient, entry: DeliveryLog): Promise<void> {
  if (entry.source === "resident") {
    await retryResidentDelivery(supabase, entry.id, entry.channel)
    return
  }
  if (entry.source === "vendor") {
    await retryVendorDelivery(supabase, entry.id, entry.channel)
    return
  }
  await retryBroadcastDelivery(supabase, entry.id, entry.channel)
}

