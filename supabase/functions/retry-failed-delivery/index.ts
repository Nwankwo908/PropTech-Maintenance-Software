import "@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  notifyResident,
  type ResidentNotifyEvent,
  normalizePhoneFlexible,
} from "../_shared/resident_notify.ts"
import { sendResendEmail } from "../_shared/delivery.ts"
import { sendOutboundSms } from "../_shared/sms/adapters.ts"
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

type RetrySource = "resident" | "vendor" | "broadcast"
type RetryChannel = "email" | "sms"
type RetryBody = {
  source?: RetrySource
  logId?: string
  channel?: RetryChannel
}

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

  await notifyResident(supabase, {
    event: eventTypeRaw,
    ticketId: String(data.ticket_id),
    recipientName: String(ticket.resident_name ?? ""),
    recipientEmail: typeof ticket.email === "string" ? ticket.email.trim() : "",
    recipientPhone:
      typeof ticket.resident_phone === "string" ? ticket.resident_phone : null,
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse(
      { error: "Server misconfiguration: missing Supabase credentials" },
      500,
    )
  }
  const supabase = createClient(supabaseUrl, serviceKey)

  let body: RetryBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Expected JSON body" }, 400)
  }

  const source = body.source
  const logId = typeof body.logId === "string" ? body.logId.trim() : ""
  const channel = body.channel

  if (source !== "resident" && source !== "vendor" && source !== "broadcast") {
    return jsonResponse({ error: "Invalid source" }, 400)
  }
  if (!logId) return jsonResponse({ error: "Missing logId" }, 400)
  if (channel !== "email" && channel !== "sms") {
    return jsonResponse({ error: "Invalid channel" }, 400)
  }

  try {
    if (source === "resident") {
      await retryResidentDelivery(supabase, logId, channel)
    } else if (source === "vendor") {
      await retryVendorDelivery(supabase, logId, channel)
    } else {
      await retryBroadcastDelivery(supabase, logId, channel)
    }
    return jsonResponse({ ok: true, source, logId, channel })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[retry-failed-delivery] retry failed", { source, logId, channel, msg })
    return jsonResponse({ error: msg || "Retry failed" }, 400)
  }
})

