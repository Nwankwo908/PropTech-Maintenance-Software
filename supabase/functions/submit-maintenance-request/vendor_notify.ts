import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  loadMostRecentlyAssignedVendorId,
  pickVendorForAssignment,
  touchVendorLastAssignedAt,
} from "../_shared/vendor_assignment.ts"
import { sendResendEmail, sendTwilioSms } from "../_shared/delivery.ts"
import { signVendorEmailAction } from "../_shared/vendor_action_token.ts"
import { notifyResidentVendorAssigned } from "./resident_notify.ts"

export type TicketNotifyPayload = {
  ticketId: string
  /** Same values as resident urgency (`urgency` / `priority` on maintenance_requests). */
  priority: string
  unit: string
  description: string
  /** ISO timestamp from SLA `due_at` (optional for legacy tickets). */
  dueAt?: string | null
  /** Deterministic SLA window in minutes (not from AI). */
  estimatedMinutes?: number | null
}

type VendorRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
  notification_channel: string
  active: boolean
  category: string | null
  portal_api_key: string | null
}

const SMS_DESC_MAX = 300

function truncateDescription(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

type VendorEmailLinks = {
  portalHome: string
  viewJob: string
  acceptUrl: string | null
  declineUrl: string | null
}

/** Ensures vendor email links are absolute (mailto clients break on host-only origins). */
function withHttpsScheme(origin: string): string {
  const t = origin.trim().replace(/\/$/, "")
  if (!t) return t
  if (/^https?:\/\//i.test(t)) return t
  return `https://${t}`
}

function resolveAppBaseUrl(): string | null {
  const appRaw = Deno.env.get("APP_URL")?.trim() ?? ""
  if (appRaw) return withHttpsScheme(appRaw)
  return null
}

function resolveVendorRespondBaseUrl(): string | null {
  const explicit = Deno.env.get("VENDOR_RESPOND_FN_URL")?.trim()?.replace(/\/$/, "") ?? ""
  if (explicit) return explicit
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()?.replace(/\/$/, "") ?? ""
  if (!supabaseUrl) return null
  return `${supabaseUrl}/functions/v1/vendor-respond`
}

async function buildVendorEmailLinks(
  ticketId: string,
  _vendorId: string,
): Promise<VendorEmailLinks | null> {
  const appBase = resolveAppBaseUrl()
  if (!appBase) return null
  const portalHome = `${appBase}/vendor`
  const viewJob = `${appBase}/vendor/ticket/${ticketId}`
  const signingSecret = Deno.env.get("VENDOR_EMAIL_ACTION_SECRET")?.trim() ?? null
  const respondBase = resolveVendorRespondBaseUrl()
  let acceptUrl: string | null = null
  let declineUrl: string | null = null
  if (signingSecret && respondBase) {
    try {
      const acceptTok = await signVendorEmailAction(signingSecret, {
        ticketId,
        vendorId: _vendorId,
        action: "accept",
      })
      const declineTok = await signVendorEmailAction(signingSecret, {
        ticketId,
        vendorId: _vendorId,
        action: "decline",
      })
      acceptUrl =
        `${respondBase}?action=accept&ticketId=${encodeURIComponent(ticketId)}&vendorId=${encodeURIComponent(_vendorId)}&token=${encodeURIComponent(acceptTok)}`
      declineUrl =
        `${respondBase}?action=decline&ticketId=${encodeURIComponent(ticketId)}&vendorId=${encodeURIComponent(_vendorId)}&token=${encodeURIComponent(declineTok)}`
    } catch (e) {
      console.error("[vendor-notify] sign email action", e)
    }
  }
  return { portalHome, viewJob, acceptUrl, declineUrl }
}

function buildEmailBodies(
  payload: TicketNotifyPayload,
  vendorName: string,
  links: VendorEmailLinks | null,
  fallbackManageUrl: string | null,
): {
  text: string
  html: string
} {
  const dueLine =
    payload.dueAt && payload.dueAt.trim()
      ? `Due by: ${new Date(payload.dueAt).toLocaleString()}`
      : null
  const estLine =
    typeof payload.estimatedMinutes === "number" &&
    Number.isFinite(payload.estimatedMinutes)
      ? `Estimated time: ${payload.estimatedMinutes} minutes`
      : null

  const textLines: string[] = [
    `Hello ${vendorName},`,
    "",
    "You have been assigned a new maintenance request.",
    "",
    `Priority: ${payload.priority}`,
    `Unit / location: ${payload.unit}`,
    ...(dueLine ? [dueLine] : []),
    ...(estLine ? [estLine] : []),
    "",
    "Description:",
    payload.description,
    "",
    `Ticket ID: ${payload.ticketId}`,
  ]

  if (links) {
    textLines.push("", `Vendor portal: ${links.portalHome}`, `View job: ${links.viewJob}`)
    if (links.acceptUrl) textLines.push(`Accept job: ${links.acceptUrl}`)
    if (links.declineUrl) textLines.push(`Decline job: ${links.declineUrl}`)
  } else if (fallbackManageUrl) {
    textLines.push("", `Open job: ${fallbackManageUrl}`)
  }

  const actionButtonsHtml =
    links && (links.acceptUrl || links.declineUrl)
      ? `<p style="margin: 20px 0 12px;">
    ${links.acceptUrl ? `<a href="${escapeHtml(links.acceptUrl)}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;background:#9810fa;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Accept Job</a>` : ""}
    ${links.declineUrl ? `<a href="${escapeHtml(links.declineUrl)}" style="display:inline-block;margin:4px 8px 4px 0;padding:10px 16px;background:#f3f4f6;color:#101828;text-decoration:none;border-radius:8px;font-weight:600;border:1px solid #e5e7eb;">Decline Job</a>` : ""}
  </p>`
      : ""

  const portalLinksHtml = links
    ? `<p style="margin: 12px 0;">
    <a href="${escapeHtml(links.portalHome)}" style="color:#9810fa;font-weight:600;">Vendor portal</a>
    · <a href="${escapeHtml(links.viewJob)}" style="color:#9810fa;font-weight:600;">View Job</a>
  </p>`
    : fallbackManageUrl
      ? `<p><a href="${escapeHtml(fallbackManageUrl)}">Open vendor portal</a></p>`
      : ""

  const dueRow =
    payload.dueAt && payload.dueAt.trim()
      ? `<tr><td style="padding: 4px 12px 4px 0; color: #6a7282;">Due by</td><td><strong>${escapeHtml(new Date(payload.dueAt).toLocaleString())}</strong></td></tr>`
      : ""
  const estRow =
    typeof payload.estimatedMinutes === "number" &&
    Number.isFinite(payload.estimatedMinutes)
      ? `<tr><td style="padding: 4px 12px 4px 0; color: #6a7282;">Est. time</td><td><strong>${escapeHtml(String(payload.estimatedMinutes))} minutes</strong></td></tr>`
      : ""

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #101828;">
  <p>Hello ${escapeHtml(vendorName)},</p>
  <p>You have been assigned a <strong>new maintenance request</strong>.</p>
  <table style="border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding: 4px 12px 4px 0; color: #6a7282;">Priority</td><td><strong>${escapeHtml(payload.priority)}</strong></td></tr>
    <tr><td style="padding: 4px 12px 4px 0; color: #6a7282;">Unit / location</td><td><strong>${escapeHtml(payload.unit)}</strong></td></tr>
    ${dueRow}
    ${estRow}
  </table>
  <p style="color: #6a7282; font-size: 14px;">Description</p>
  <p style="white-space: pre-wrap;">${escapeHtml(payload.description)}</p>
  <p style="font-size: 12px; color: #6a7282;">Ticket ID: ${escapeHtml(payload.ticketId)}</p>
  ${portalLinksHtml}
  ${actionButtonsHtml}
</body>
</html>`.trim()

  return { text: textLines.join("\n"), html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function buildSmsBody(
  payload: TicketNotifyPayload,
  primaryUrl: string | null,
  acceptUrl: string | null,
  declineUrl: string | null,
): string {
  const linkBlock = [primaryUrl, acceptUrl, declineUrl].filter(Boolean).join("\n")
  const reservedForLink = linkBlock.length > 0 ? Math.min(400, linkBlock.length + 40) : 0
  const descMax = Math.max(60, SMS_DESC_MAX - reservedForLink)
  const desc = truncateDescription(payload.description, descMax)
  const dueSms =
    payload.dueAt && payload.dueAt.trim()
      ? `Due by: ${new Date(payload.dueAt).toLocaleString()}`
      : null
  const estSms =
    typeof payload.estimatedMinutes === "number" &&
    Number.isFinite(payload.estimatedMinutes)
      ? `Est. time: ${payload.estimatedMinutes} min`
      : null

  const parts: string[] = [
    `New job assigned (${payload.priority})`,
    `Unit: ${payload.unit}`,
    ...(dueSms ? [dueSms] : []),
    ...(estSms ? [estSms] : []),
    "",
    desc,
    "",
    `Ref: ${payload.ticketId}`,
  ]
  if (primaryUrl) {
    parts.push("", `View: ${truncateDescription(primaryUrl, 220)}`)
  }
  if (acceptUrl) {
    parts.push(`Accept: ${truncateDescription(acceptUrl, 200)}`)
  }
  if (declineUrl) {
    parts.push(`Decline: ${truncateDescription(declineUrl, 200)}`)
  }
  return parts.join("\n")
}

/**
 * Picks vendor by strict issue_category match → generalists → any active (see `pickVendorForAssignment`).
 */
async function resolveVendorForNewTicket(
  supabase: SupabaseClient,
  issueCategory: string | null,
): Promise<VendorRow | null> {
  const preferNot = await loadMostRecentlyAssignedVendorId(supabase)
  const picked = await pickVendorForAssignment(supabase, {
    issueCategory,
    excludeVendorIds: [],
    preferNotVendorId: preferNot,
  })
  return picked ? (picked as VendorRow) : null
}

async function insertLog(
  supabase: SupabaseClient,
  ticketId: string,
  _vendorId: string,
  channel: "email" | "sms",
  providerMessageId: string | null,
  error: string | null,
): Promise<void> {
  const { error: insErr } = await supabase.from("vendor_notification_log").insert({
    ticket_id: ticketId,
    vendor_id: _vendorId,
    channel,
    provider_message_id: providerMessageId,
    error,
  })
  if (insErr) console.error("[vendor-notify] log insert", insErr)
}

/** Fallback deep link when `buildVendorEmailLinks` cannot resolve APP_URL. */
function portalManageUrl(ticketId: string): string | null {
  const appBase = resolveAppBaseUrl()
  if (!appBase) return null
  return `${appBase}/vendor/ticket/${encodeURIComponent(ticketId)}`
}

/**
 * Sends email/SMS for an assignment; returns non-fatal channel errors.
 */
async function notifyChannelsForAssignment(
  supabase: SupabaseClient,
  ticketId: string,
  vendor: VendorRow,
  payload: TicketNotifyPayload,
): Promise<string[]> {
  const errors: string[] = []
  const ch = vendor.notification_channel

  const wantEmail = ch === "email" || ch === "both"
  const wantSms = ch === "sms" || ch === "both"

  const emailLinks = await buildVendorEmailLinks(ticketId, vendor.id)
  const legacyManage = portalManageUrl(ticketId)

  if (wantEmail) {
    if (!vendor.email?.trim()) {
      errors.push("email: vendor has no email")
      await insertLog(supabase, ticketId, vendor.id, "email", null, "no vendor email")
    } else {
      const { text, html } = buildEmailBodies(
        payload,
        vendor.name,
        emailLinks,
        legacyManage,
      )
      const subject = "New Maintenance Job Assigned"
      const r = await sendResendEmail(vendor.email.trim(), subject, text, html)
      if ("error" in r) {
        errors.push(`email: ${r.error}`)
        await insertLog(supabase, ticketId, vendor.id, "email", null, r.error)
      } else {
        await insertLog(supabase, ticketId, vendor.id, "email", r.id, null)
      }
    }
  }

  if (wantSms) {
    if (!vendor.phone?.trim()) {
      errors.push("sms: vendor has no phone")
      await insertLog(supabase, ticketId, vendor.id, "sms", null, "no vendor phone")
    } else {
      const smsBody = buildSmsBody(
        payload,
        emailLinks?.viewJob ?? legacyManage,
        emailLinks?.acceptUrl ?? null,
        emailLinks?.declineUrl ?? null,
      )
      const r = await sendTwilioSms(vendor.phone.trim(), smsBody)
      if ("error" in r) {
        errors.push(`sms: ${r.error}`)
        await insertLog(supabase, ticketId, vendor.id, "sms", null, r.error)
      } else {
        await insertLog(supabase, ticketId, vendor.id, "sms", r.sid, null)
      }
    }
  }

  return errors
}

/**
 * Assigns an active vendor to the ticket and sends email/SMS per vendor.notification_channel.
 * Does not throw — logs errors and sets maintenance_requests.vendor_notify_error.
 */
export async function assignVendorAndNotify(
  supabase: SupabaseClient,
  payload: TicketNotifyPayload,
): Promise<void> {
  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select("id, vendor_notified_at, issue_category")
    .eq("id", payload.ticketId)
    .maybeSingle()

  if (!ticket) {
    console.error("[vendor-notify] ticket not found", payload.ticketId)
    return
  }
  if (ticket.vendor_notified_at) {
    console.log("[vendor-notify] skip, already notified", payload.ticketId)
    return
  }

  const issueCategory =
    typeof ticket.issue_category === "string" && ticket.issue_category.trim()
      ? ticket.issue_category.trim()
      : null

  const vendor = await resolveVendorForNewTicket(supabase, issueCategory)
  if (!vendor) {
    console.warn("[vendor-notify] no active vendor; skipping assignment and notify")
    return
  }
  const assignedAt = new Date().toISOString()
  const actionToken = crypto.randomUUID()
  /** Single update: assigned_vendor_id + pending_accept together satisfies require_vendor_for_progress. */
  const { error: assignError } = await supabase
    .from("maintenance_requests")
    .update({
      assigned_vendor_id: vendor.id,
      assigned_at: assignedAt,
      vendor_action_token: actionToken,
      vendor_work_status: "pending_accept",
      issue_category: issueCategory ?? vendor.category ?? null,
    })
    .eq("id", payload.ticketId)

  if (assignError) {
    console.error(
      "[vendor-notify] failed to persist vendor assignment + workflow",
      assignError,
    )
    await supabase
      .from("maintenance_requests")
      .update({ vendor_notify_error: assignError.message })
      .eq("id", payload.ticketId)
    return
  }

  console.log("[vendor-notify] assigned vendor persisted", {
    ticketId: payload.ticketId,
    _vendorId: vendor.id,
  })

  await touchVendorLastAssignedAt(supabase, vendor.id)

  const errors = await notifyChannelsForAssignment(
    supabase,
    payload.ticketId,
    vendor,
    payload,
  )

  const now = new Date().toISOString()
  await supabase
    .from("maintenance_requests")
    .update({
      vendor_notified_at: now,
      vendor_notify_error: errors.length > 0 ? errors.join("; ") : null,
    })
    .eq("id", payload.ticketId)

  if (errors.length > 0) {
    console.warn("[vendor-notify] completed with errors", payload.ticketId, errors)
  }

  const { data: contact } = await supabase
    .from("maintenance_requests")
    .select(
      "resident_name, email, resident_phone, unit, resident_notification_channel",
    )
    .eq("id", payload.ticketId)
    .maybeSingle()

  if (contact) {
    await notifyResidentVendorAssigned(supabase, {
      ticketId: payload.ticketId,
      recipientName: String(contact.resident_name ?? ""),
      recipientEmail:
        typeof contact.email === "string" ? contact.email.trim() : "",
      recipientPhone:
        typeof contact.resident_phone === "string"
          ? contact.resident_phone
          : null,
      notificationChannel:
        typeof contact.resident_notification_channel === "string"
          ? contact.resident_notification_channel
          : null,
      unit: typeof contact.unit === "string" ? contact.unit : undefined,
      priority: payload.priority,
      vendorName: vendor.name,
    })
  }
}

/**
 * Admin reassignment: sets `assigned_vendor_id`, rotates `vendor_action_token`, resets workflow to
 * `pending_accept`, clears prior notify timestamps, notifies the new vendor, writes `vendor_status_events`.
 * Does not throw — returns `{ ok: true }` or `{ error: string }` for HTTP mapping.
 */
export type ReassignVendorNotifyOptions = {
  /** Audit `vendor_status_events.source` (default `edge`). */
  eventSource?: "edge" | "auto_reassign"
}

export async function reassignVendorByIdAndNotify(
  supabase: SupabaseClient,
  ticketId: string,
  _vendorId: string,
  opts?: ReassignVendorNotifyOptions,
): Promise<{ ok: true } | { error: string }> {
  const { data: ticket, error: tErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, priority, urgency, unit, description, vendor_work_status, issue_category, due_at, estimated_minutes",
    )
    .eq("id", ticketId)
    .maybeSingle()

  if (tErr) {
    console.error("[vendor-notify] reassign load ticket", tErr)
    return { error: "Load ticket failed" }
  }
  if (!ticket) {
    return { error: "Ticket not found" }
  }

  const { data: vendor, error: vErr } = await supabase
    .from("vendors")
    .select("id,name,email,phone,notification_channel,active,category,portal_api_key")
    .eq("id", _vendorId)
    .eq("active", true)
    .maybeSingle()

  if (vErr) {
    console.error("[vendor-notify] reassign vendor lookup", vErr)
    return { error: "Load vendor failed" }
  }
  if (!vendor) {
    return { error: "Vendor not found or inactive" }
  }
  const prevStatus = ticket.vendor_work_status as string
  const actionToken = crypto.randomUUID()

  const eventSource = opts?.eventSource ?? "edge"

  const existingIssueCat =
    typeof ticket.issue_category === "string" && ticket.issue_category.trim()
      ? ticket.issue_category.trim()
      : null

  const { error: upAssign } = await supabase
    .from("maintenance_requests")
    .update({
      assigned_vendor_id: vendor.id,
      vendor_action_token: actionToken,
      vendor_work_status: "pending_accept",
      vendor_notified_at: null,
      vendor_notify_error: null,
      issue_category: existingIssueCat ?? vendor.category ?? null,
    })
    .eq("id", ticketId)

  if (upAssign) {
    console.error("[vendor-notify] reassign update failed", upAssign)
    return { error: upAssign.message ?? "Update failed" }
  }

  await touchVendorLastAssignedAt(supabase, vendor.id)

  const urgencyOrPriority =
    (typeof ticket.urgency === "string" && ticket.urgency.trim()
      ? ticket.urgency
      : ticket.priority) as string

  const dueRaw = ticket.due_at as string | null | undefined
  const estRaw = ticket.estimated_minutes as number | null | undefined

  const payload: TicketNotifyPayload = {
    ticketId,
    priority: urgencyOrPriority,
    unit: ticket.unit as string,
    description: ticket.description as string,
    dueAt: typeof dueRaw === "string" && dueRaw.trim() ? dueRaw : null,
    estimatedMinutes:
      typeof estRaw === "number" && Number.isFinite(estRaw) ? estRaw : null,
  }

  const errors = await notifyChannelsForAssignment(
    supabase,
    ticketId,
    vendor as VendorRow,
    payload,
  )

  const now = new Date().toISOString()
  await supabase
    .from("maintenance_requests")
    .update({
      vendor_notified_at: now,
      vendor_notify_error: errors.length > 0 ? errors.join("; ") : null,
    })
    .eq("id", ticketId)

  const { error: logErr } = await supabase.from("vendor_status_events").insert({
    ticket_id: ticketId,
    from_status: prevStatus,
    to_status: "pending_accept",
    source: eventSource,
    vendor_id: vendor.id,
  })
  if (logErr) console.error("[vendor-notify] reassign audit", logErr)

  if (errors.length > 0) {
    console.warn("[vendor-notify] reassign completed with notify errors", ticketId, errors)
  }

  const { data: contact } = await supabase
    .from("maintenance_requests")
    .select(
      "resident_name, email, resident_phone, unit, resident_notification_channel",
    )
    .eq("id", ticketId)
    .maybeSingle()

  if (contact) {
    await notifyResidentVendorAssigned(supabase, {
      ticketId,
      recipientName: String(contact.resident_name ?? ""),
      recipientEmail:
        typeof contact.email === "string" ? contact.email.trim() : "",
      recipientPhone:
        typeof contact.resident_phone === "string"
          ? contact.resident_phone
          : null,
      notificationChannel:
        typeof contact.resident_notification_channel === "string"
          ? contact.resident_notification_channel
          : null,
      unit: typeof contact.unit === "string" ? contact.unit : undefined,
      priority: urgencyOrPriority,
      vendorName: vendor.name as string,
    })
  }

  return { ok: true }
}
