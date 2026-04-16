import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail, sendTwilioSms } from "./delivery.ts"

export type ResidentNotifyEvent =
  | "ticket_submitted"
  | "vendor_assigned"
  | "repair_in_progress"
  | "repair_completed"

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Strips formatting and normalizes to E.164-style `+` + digits (US 10/11 digit and longer intl. fallbacks).
 */
export function normalizePhoneFlexible(
  input: string | null | undefined,
): string | null {
  if (input == null) return null
  const t = String(input).trim()
  if (!t) return null

  // Remove all non-numeric characters
  let digits = t.replace(/\D/g, "")

  // Handle US numbers
  if (digits.length === 10) {
    digits = "1" + digits
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return "+" + digits
  }

  // If already includes country code (basic fallback)
  if (digits.length > 11) {
    return "+" + digits
  }

  return null
}

/** @deprecated Prefer `normalizePhoneFlexible`; kept as an alias for existing imports. */
export const normalizeResidentPhone = normalizePhoneFlexible

function truncate(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function subjectForEvent(event: ResidentNotifyEvent): string {
  switch (event) {
    case "ticket_submitted":
      return "We received your maintenance request"
    case "vendor_assigned":
      return "A vendor has been assigned to your request"
    case "repair_in_progress":
      return "Repair in progress on your maintenance request"
    case "repair_completed":
      return "Your maintenance request is complete"
  }
}

function buildEmail(
  event: ResidentNotifyEvent,
  recipientName: string,
  ticketId: string,
  ctx: {
    unit?: string
    priority?: string
    descriptionPreview?: string
    vendorName?: string
  },
): { text: string; html: string } {
  const name = recipientName.trim() || "there"
  const unitLine = ctx.unit?.trim()
    ? `Unit / location: ${ctx.unit.trim()}`
    : null
  const pri = ctx.priority?.trim()
  const desc = ctx.descriptionPreview?.trim()
  const vendor = ctx.vendorName?.trim()

  let bodyText = ""
  switch (event) {
    case "ticket_submitted":
      bodyText =
        `Hi ${name},\n\nThank you — we've received your maintenance request and will keep you updated.\n\n` +
        (unitLine ? `${unitLine}\n` : "") +
        (pri ? `Priority: ${pri}\n` : "") +
        (desc ? `\nSummary:\n${desc}\n` : "") +
        `\nReference: ${ticketId}\n`
      break
    case "vendor_assigned":
      bodyText =
        `Hi ${name},\n\nA vendor has been assigned to your maintenance request` +
        (vendor ? `: ${vendor}` : "") +
        ".\n\n" +
        (unitLine ? `${unitLine}\n` : "") +
        `\nReference: ${ticketId}\n`
      break
    case "repair_in_progress":
      bodyText =
        `Hi ${name},\n\nWork is now in progress on your maintenance request.\n\n` +
        (vendor ? `Vendor: ${vendor}\n` : "") +
        (unitLine ? `${unitLine}\n` : "") +
        `\nReference: ${ticketId}\n`
      break
    case "repair_completed":
      bodyText =
        `Hi ${name},\n\nYour maintenance request has been marked complete. If anything still needs attention, please contact your property office.\n\n` +
        (unitLine ? `${unitLine}\n` : "") +
        `\nReference: ${ticketId}\n`
      break
  }

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #101828;">
  <p>Hi ${escapeHtml(name)},</p>
  ${event === "ticket_submitted"
    ? `<p>Thank you — we've received your <strong>maintenance request</strong> and will keep you updated.</p>`
    : event === "vendor_assigned"
    ? `<p>A vendor has been assigned to your maintenance request${vendor ? `: <strong>${escapeHtml(vendor)}</strong>` : ""}.</p>`
    : event === "repair_in_progress"
    ? `<p>Work is now <strong>in progress</strong> on your maintenance request.</p>`
    : `<p>Your maintenance request has been marked <strong>complete</strong>.</p>`}
  ${unitLine
    ? `<p style="color:#6a7282;font-size:14px;">${escapeHtml(unitLine)}</p>`
    : ""}
  ${pri && event === "ticket_submitted"
    ? `<p>Priority: <strong>${escapeHtml(pri)}</strong></p>`
    : ""}
  ${desc && event === "ticket_submitted"
    ? `<p style="color:#6a7282;">Summary</p><p style="white-space:pre-wrap;">${escapeHtml(desc)}</p>`
    : ""}
  ${vendor && event === "repair_in_progress"
    ? `<p>Vendor: <strong>${escapeHtml(vendor)}</strong></p>`
    : ""}
  <p style="font-size:12px;color:#6a7282;">Reference: ${escapeHtml(ticketId)}</p>
</body>
</html>`.trim()

  return { text: bodyText.trim(), html }
}

function buildSms(
  event: ResidentNotifyEvent,
  ticketId: string,
  ctx: {
    unit?: string
    vendorName?: string
  },
): string {
  const unit = ctx.unit?.trim()
  const vendor = ctx.vendorName?.trim()
  switch (event) {
    case "ticket_submitted":
      return truncate(
        `Maintenance request received. ${unit ? `Unit: ${unit}. ` : ""}Ref: ${ticketId}`,
        300,
      )
    case "vendor_assigned":
      return truncate(
        `Vendor assigned${vendor ? `: ${vendor}` : ""}. ${unit ? `Unit: ${unit}. ` : ""}Ref: ${ticketId}`,
        300,
      )
    case "repair_in_progress":
      return truncate(
        `Repair in progress${vendor ? ` (${vendor})` : ""}. Ref: ${ticketId}`,
        300,
      )
    case "repair_completed":
      return truncate(
        `Maintenance request complete. ${unit ? `Unit: ${unit}. ` : ""}Ref: ${ticketId}`,
        300,
      )
  }
}

async function insertResidentLog(
  supabase: SupabaseClient,
  ticketId: string,
  eventType: ResidentNotifyEvent,
  channel: "email" | "sms",
  providerMessageId: string | null,
  error: string | null,
): Promise<void> {
  const { error: insErr } = await supabase.from("resident_notification_log").insert({
    ticket_id: ticketId,
    event_type: eventType,
    channel,
    provider_message_id: providerMessageId,
    error,
  })
  if (insErr) console.error("[resident-notify] log insert", insErr)
}

async function hasSuccessfulPriorEvent(
  supabase: SupabaseClient,
  ticketId: string,
  event: ResidentNotifyEvent,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("resident_notification_log")
    .select("id", { count: "exact", head: true })
    .eq("ticket_id", ticketId)
    .eq("event_type", event)
    .is("error", null)
  if (error) {
    console.warn("[resident-notify] dedupe check", error.message)
    return false
  }
  return (count ?? 0) > 0
}

export type ResidentNotificationChannel = "email" | "sms" | "both"

export function normalizeResidentNotificationChannel(
  raw: string | null | undefined,
): ResidentNotificationChannel {
  const x = (raw ?? "both").trim().toLowerCase()
  if (x === "email" || x === "sms" || x === "both") return x
  return "both"
}

export type ResidentNotifyInput = {
  event: ResidentNotifyEvent
  ticketId: string
  recipientName: string
  /** Required on ticket for `email` / `both`; may be empty only if channel is `sms` and phone is set. */
  recipientEmail: string
  recipientPhone: string | null
  /** From `maintenance_requests.resident_notification_channel`. */
  notificationChannel?: string | null
  unit?: string
  priority?: string
  descriptionPreview?: string
  vendorName?: string
}

/**
 * Sends transactional email and/or SMS per `notificationChannel`.
 * Logs each channel attempt. Does not throw.
 */
export async function notifyResident(
  supabase: SupabaseClient,
  input: ResidentNotifyInput,
): Promise<void> {
  const ch = normalizeResidentNotificationChannel(input.notificationChannel)
  const wantEmail = ch === "email" || ch === "both"
  const wantSms = ch === "sms" || ch === "both"

  const email = input.recipientEmail.trim()
  const phoneE164 = normalizePhoneFlexible(input.recipientPhone)

  if (!wantEmail && !wantSms) {
    return
  }

  if (wantSms && !phoneE164 && !wantEmail) {
    console.warn("[resident-notify] sms-only but no valid phone", input.ticketId)
    await insertResidentLog(
      supabase,
      input.ticketId,
      input.event,
      "sms",
      null,
      "skipped: no valid phone for SMS-only channel",
    )
    return
  }

  if (input.event === "ticket_submitted") {
    const dup = await hasSuccessfulPriorEvent(
      supabase,
      input.ticketId,
      "ticket_submitted",
    )
    if (dup) {
      console.log("[resident-notify] skip duplicate ticket_submitted", input.ticketId)
      return
    }
  }

  const { text, html } = buildEmail(
    input.event,
    input.recipientName,
    input.ticketId,
    {
      unit: input.unit,
      priority: input.priority,
      descriptionPreview: input.descriptionPreview,
      vendorName: input.vendorName,
    },
  )
  const subject = subjectForEvent(input.event)

  if (wantEmail) {
    if (!email) {
      console.warn("[resident-notify] email channel requested but no email", input.ticketId)
      await insertResidentLog(
        supabase,
        input.ticketId,
        input.event,
        "email",
        null,
        "skipped: no email on ticket",
      )
    } else {
      const rEmail = await sendResendEmail(email, subject, text, html)
      if ("error" in rEmail) {
        console.error("[resident-notify] email failed", input.ticketId, rEmail.error)
        await insertResidentLog(
          supabase,
          input.ticketId,
          input.event,
          "email",
          null,
          rEmail.error,
        )
      } else {
        await insertResidentLog(
          supabase,
          input.ticketId,
          input.event,
          "email",
          rEmail.id,
          null,
        )
      }
    }
  }

  if (!wantSms) {
    return
  }

  if (!phoneE164) {
    await insertResidentLog(
      supabase,
      input.ticketId,
      input.event,
      "sms",
      null,
      ch === "both"
        ? "skipped: no valid phone for SMS"
        : "skipped: no valid phone for SMS-only channel",
    )
    return
  }

  const smsBody = buildSms(input.event, input.ticketId, {
    unit: input.unit,
    vendorName: input.vendorName,
  })
  const rSms = await sendTwilioSms(phoneE164, smsBody)
  if ("error" in rSms) {
    console.error("[resident-notify] sms failed", input.ticketId, rSms.error)
    await insertResidentLog(
      supabase,
      input.ticketId,
      input.event,
      "sms",
      null,
      rSms.error,
    )
  } else {
    await insertResidentLog(
      supabase,
      input.ticketId,
      input.event,
      "sms",
      rSms.sid,
      null,
    )
  }
}
