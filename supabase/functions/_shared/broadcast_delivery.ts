/**
 * Shared broadcast recipient resolution + Resend/Twilio delivery + log rows.
 * Used by send-broadcast (immediate) and run-scheduled-broadcasts (cron).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { sendResendEmail, sendTwilioSms } from "./delivery.ts"
import { normalizePhoneFlexible } from "./resident_notify.ts"

export type BroadcastChannel = "email" | "sms"
export type BroadcastAudience = "all" | "building" | "units"

export type BroadcastUserRow = {
  id: string
  email: string
  full_name: string
  phone: string | null
  unit: string | null
  building: string | null
  status: string
  role: string | null
}

/** Same shape as immediate-send `users` select (`id, full_name, email, phone`). */
export type BroadcastRecipientRow = {
  id: string
  full_name?: string | null
  email?: string | null
  phone?: string | null
}

export const BROADCAST_RECIPIENT_SCAN_LIMIT = 5000
const SMS_BODY_MAX = 1500

type BroadcastBillingContext = {
  amountDue: number | null
  dueDate: string | null
}

function parseBroadcastBillingContext(payload: unknown): BroadcastBillingContext {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { amountDue: null, dueDate: null }
  }
  const p = payload as Record<string, unknown>
  let amountDue: number | null = null
  const rawAmount = p.amount_due
  if (typeof rawAmount === "number" && Number.isFinite(rawAmount)) {
    amountDue = rawAmount
  } else if (typeof rawAmount === "string") {
    const parsed = Number.parseFloat(rawAmount.replace(/[^0-9.]/g, ""))
    if (Number.isFinite(parsed)) amountDue = parsed
  }
  const dueDate =
    typeof p.due_date === "string" && p.due_date.trim() ? p.due_date.trim() : null
  return { amountDue, dueDate }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function normalizeUnitForMatch(v: string | null | undefined): string {
  let s = (v ?? "").trim().toLowerCase()
  s = s.replace(/#/g, "")
  s = s.replace(/\b(unit|apt)\b/g, "")
  s = s.replace(/[^a-z0-9]/g, "")
  return s
}

export function escapeBroadcastIlikeLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")
}

/** Twilio trial / unverified destination → stable `broadcast_notification_log.error`. */
function broadcastSmsFailureLogMessage(raw: string): string {
  const s = raw.trim()
  if (/twilio not configured/i.test(s)) return "Twilio not configured"

  let code: number | undefined
  let message = ""
  try {
    const j = JSON.parse(s) as { code?: number; message?: string }
    if (typeof j.code === "number") code = j.code
    if (typeof j.message === "string") message = j.message
  } catch {
    // use raw string only
  }

  const haystack = `${s} ${message}`.toLowerCase()
  const trialLike =
    code === 21608 ||
    /\b21608\b/.test(s) ||
    (haystack.includes("trial") &&
      (haystack.includes("unverified") ||
        haystack.includes("not verified") ||
        haystack.includes("verify your"))) ||
    /trial account.*cannot send|cannot send.*trial|only send sms to verified/i.test(haystack)

  if (trialLike) return "Twilio trial restriction"
  return s.slice(0, 2000)
}

export function buildBroadcastEmail(
  subject: string,
  message: string,
  recipientName: string,
  payload?: unknown,
): { text: string; html: string } {
  const name = recipientName.trim() || "there"
  const billing = parseBroadcastBillingContext(payload)
  const billingLines: string[] = []
  if (billing.amountDue != null) {
    billingLines.push(`Amount due: $${billing.amountDue.toFixed(2)}`)
  }
  if (billing.dueDate) {
    billingLines.push(`Due date: ${billing.dueDate}`)
  }
  const text = [
    subject,
    "",
    `Hi ${name},`,
    "",
    message,
    ...(billingLines.length > 0 ? ["", ...billingLines] : []),
    "",
  ].join("\n")
  const bodyEscaped = escapeHtml(message).replace(/\n/g, "<br/>")
  const billingHtml =
    billingLines.length > 0
      ? `<p style="margin-top:12px;"><strong>${billingLines
          .map((line) => escapeHtml(line))
          .join("<br/>")}</strong></p>`
      : ""
  const html =
    `<p><strong>${escapeHtml(subject)}</strong></p><p>Hi ${escapeHtml(name)},</p><p>${bodyEscaped}</p>${billingHtml}`
  return { text, html }
}

export function broadcastSmsBody(subject: string, message: string, payload?: unknown): string {
  const billing = parseBroadcastBillingContext(payload)
  const head = subject.trim()
  const body = message.trim()
  const billingTail: string[] = []
  if (billing.amountDue != null) billingTail.push(`Amount due $${billing.amountDue.toFixed(2)}`)
  if (billing.dueDate) billingTail.push(`Due ${billing.dueDate}`)
  const combined = head
    ? `${head}: ${body}${billingTail.length > 0 ? `. ${billingTail.join(". ")}` : ""}`
    : `${body}${billingTail.length > 0 ? `. ${billingTail.join(". ")}` : ""}`
  if (combined.length <= SMS_BODY_MAX) return combined
  return combined.slice(0, SMS_BODY_MAX - 1) + "…"
}

/** Raw `users` rows for broadcast delivery (active/pending; building filter when applicable). */
export async function fetchBroadcastUsersFromDb(
  supabase: SupabaseClient,
  audience: BroadcastAudience,
  building: string,
): Promise<{ data: BroadcastUserRow[] | null; error: { message: string } | null }> {
  let q = supabase
    .from("users")
    .select("id, full_name, email, phone, unit, building, status, role")
    .in("status", ["active", "pending"])
    .limit(BROADCAST_RECIPIENT_SCAN_LIMIT)

  if (audience === "building") {
    q = q.ilike("building", escapeBroadcastIlikeLiteral(building.trim()))
  }

  const { data, error } = await q
  return {
    data: data as BroadcastUserRow[] | null,
    error: error ? { message: error.message } : null,
  }
}

/** Resident roster + optional unit list (must match `fetchBroadcastUsersFromDb` audience rules). */
export function filterBroadcastUserRowsForAudience(
  rows: BroadcastUserRow[],
  audience: BroadcastAudience,
  units: string[],
): BroadcastUserRow[] {
  const roster = rows.filter((r) => {
    const role = (r.role ?? "resident").toLowerCase()
    return role === "resident"
  })

  if (audience === "units") {
    const wanted = new Set(
      units.map((u) => normalizeUnitForMatch(u)).filter((k) => k.length > 0),
    )
    if (wanted.size === 0) return []
    return roster.filter((r) => wanted.has(normalizeUnitForMatch(r.unit)))
  }

  return roster
}

export async function getBroadcastRecipients(
  supabase: SupabaseClient,
  audience: BroadcastAudience,
  building: string,
  units: string[],
): Promise<BroadcastUserRow[]> {
  const { data, error } = await fetchBroadcastUsersFromDb(supabase, audience, building)

  if (error) {
    console.error("[broadcast-delivery] getRecipients query failed", error.message)
    throw new Error(error.message)
  }

  return filterBroadcastUserRowsForAudience((data ?? []) as BroadcastUserRow[], audience, units)
}

async function loadSuccessKeys(
  supabase: SupabaseClient,
  broadcastId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("broadcast_notification_log")
    .select("recipient_user_id, channel")
    .eq("broadcast_id", broadcastId)
    .eq("success", true)

  if (error || !data) {
    return new Set()
  }
  const keys = new Set<string>()
  for (const row of data as { recipient_user_id: string; channel: string }[]) {
    const uid = row.recipient_user_id
    const ch = row.channel
    if (uid && (ch === "email" || ch === "sms")) {
      keys.add(`${uid}:${ch}`)
    }
  }
  return keys
}

export type DeliverBroadcastResult = {
  recipients_count: number
  attemptsOk: number
  attemptsFail: number
  /** Same semantics as immediate send terminal states (completed = all OK or nothing to send). */
  immediateTerminalStatus: "completed" | "partial" | "failed"
}

/**
 * Sends to each recipient for each channel. Every (recipient, channel) attempt produces exactly
 * one `broadcast_notification_log` row (`recipient_id` / `recipient_user_id` set to the user).
 * When `resume` is true, skips pairs that already have a successful log row (no duplicate send/log).
 */
/** Immediate send passes `recipients`; cron passes `audience` + `building` + `units`. */
export type DeliverBroadcastMessagesParams =
  | {
      subject: string
      message: string
      channels: BroadcastChannel[]
      payload?: unknown
      /** Defaults to `false` when omitted (fresh send). */
      resume?: boolean
      recipients: BroadcastRecipientRow[]
    }
  | {
      subject: string
      message: string
      channels: BroadcastChannel[]
      payload?: unknown
      resume?: boolean
      audience: BroadcastAudience
      building: string
      units: string[]
    }

export async function deliverBroadcastMessages(
  supabase: SupabaseClient,
  broadcastId: string,
  params: DeliverBroadcastMessagesParams,
): Promise<DeliverBroadcastResult> {
  const resume =
    "recipients" in params && Array.isArray(params.recipients)
      ? Boolean(params.resume)
      : params.resume !== false
  const skipKeys = resume ? await loadSuccessKeys(supabase, broadcastId) : new Set<string>()

  let recipients: BroadcastRecipientRow[]
  if ("recipients" in params && Array.isArray(params.recipients)) {
    recipients = params.recipients
  } else {
    const { audience, building, units } = params as {
      audience: BroadcastAudience
      building: string
      units: string[]
    }
    recipients = await getBroadcastRecipients(supabase, audience, building, units)
  }

  const channels = params.channels
  let successCount = 0
  let failCount = 0

  for (const recipient of recipients) {
    console.log("🔥 NEW DELIVERY FILE ACTIVE 🔥", recipient)

    for (const channel of channels) {
      const skipKey = `${recipient.id}:${channel}`
      if (skipKeys.has(skipKey)) {
        continue
      }

      let success = false
      let error: string | null = null
      let providerMessageId: string | null = null
      let recipientEmail: string | null = (recipient.email ?? "").trim() || null

      try {
        if (channel === "email") {
          const addr = (recipient.email ?? "").trim()
          if (!addr) {
            throw new Error("skipped: no email on file")
          }
          recipientEmail = addr
          const { text, html } = buildBroadcastEmail(
            params.subject,
            params.message,
            recipient.full_name ?? "",
            params.payload,
          )
          const result = await sendResendEmail(addr, params.subject, text, html)
          if ("error" in result) {
            throw new Error(result.error)
          }
          providerMessageId = result.id
          success = true
        } else {
          const phoneE164 = normalizePhoneFlexible(recipient.phone)
          if (!phoneE164) {
            throw new Error("skipped: no valid phone for SMS")
          }
          const sms = broadcastSmsBody(params.subject, params.message, params.payload)
          const result = await sendTwilioSms(phoneE164, sms)
          if ("error" in result) {
            throw new Error(result.error)
          }
          providerMessageId = result.sid
          success = true
        }
      } catch (err) {
        success = false
        const raw = err instanceof Error ? err.message : String(err)
        error = channel === "sms" ? broadcastSmsFailureLogMessage(raw) : raw
      }

      // Required: recipient_id + recipient_type + error (not just broadcast_id/channel/success).
      console.log("INSERT DEBUG → recipient:", recipient)
      console.log("INSERT DEBUG → recipient.id:", recipient.id)
      const { error: logInsertError } = await supabase
        .from("broadcast_notification_log")
        .insert({
          broadcast_id: broadcastId,
          recipient_type: "resident",
          recipient_id: recipient.id,
          channel,
          success,
          error,
          recipient_user_id: recipient.id,
          recipient_email: recipientEmail,
          recipient_name: recipient.full_name ?? null,
          provider_message_id: success ? providerMessageId : null,
        })
      if (logInsertError) {
        console.error("[broadcast-delivery] insert log failed", logInsertError)
      }

      if (success) successCount++
      else failCount++
    }
  }

  const immediateTerminalStatus: DeliverBroadcastResult["immediateTerminalStatus"] =
    failCount === 0 ? "completed" : successCount > 0 ? "partial" : "failed"

  return {
    attemptsOk: successCount,
    attemptsFail: failCount,
    recipients_count: recipients.length,
    immediateTerminalStatus,
  }
}

/** Maps immediate-send terminal status to DB status after a scheduled run. */
export function scheduledRunFinalStatus(
  immediate: DeliverBroadcastResult["immediateTerminalStatus"],
): "sent" | "partial" | "failed" {
  if (immediate === "completed") return "sent"
  return immediate
}
