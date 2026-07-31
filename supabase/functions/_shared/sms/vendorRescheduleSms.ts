/**
 * Vendor SMS reschedule: detect intent → bind WO → update schedule → notify
 * resident + landlord → await resident CONFIRM.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { sendLandlordOpsEmail } from "../landlordOpsNotify.ts"
import { normalizePhoneFlexible } from "../resident_notify.ts"
import {
  parseAvailabilityResolved,
  parseAvailabilityToScheduledAt,
  scheduleTimeZone,
} from "../vendor_availability_parse.ts"
import {
  formatWorkOrderRef,
  vendorCompanyName,
} from "../vendor_outreach_copy.ts"
import {
  createIdleScheduleState,
  persistVendorScheduleFsm,
} from "../vendor_schedule_fsm.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "./inbound_db.ts"
import { sendInboundAutoReply } from "./inboundReply.ts"
import { findActiveLandlordMainNumber } from "./landlordSmsOnboarding.ts"
import { getSMSProvider } from "./providerFactory.ts"
import { findActiveLandlordMain } from "./smsNumberPool.ts"
import type { SmsProviderName } from "./types.ts"

/** Keep in sync with tenantScheduleConfirm.AWAITING_SCHEDULE_CONFIRM_KEY */
const AWAITING_SCHEDULE_CONFIRM_KEY = "awaiting_schedule_confirmation"
import {
  createVendorWorkOrderClarification,
  matchActiveJobsFromReply,
  persistVendorWorkOrderClarification,
  type VendorActiveJob,
} from "./vendorWorkOrderClarification.ts"

export const VENDOR_RESCHEDULE_PENDING_KEY = "vendor_reschedule_pending"
export const VENDOR_RESCHEDULE_PENDING_TTL_MS = 30 * 60 * 1000

const RESCHEDULE_INTENT =
  /\b(reschedule|re-?schedule|push(?:\s+the)?(?:\s+visit|\s+appointment|\s+it)?|move(?:\s+the)?(?:\s+appointment|\s+visit|\s+it)?|come\s+later|change(?:\s+the)?\s+time|running\s+late|delayed|running\s+behind|running\s+over|won'?t\s+make|cannot\s+make|can'?t\s+make|need\s+to\s+move|instead(?:\s+of)?)\b/i

const BLOCKED_STATUSES = new Set([
  "completed",
  "cancelled",
  "canceled",
  "declined",
  "unassigned",
])

export type VendorRescheduleDetect = {
  isReschedule: boolean
  confidence: number
  reason: string | null
}

export type VendorReschedulePending = {
  ticketId: string | null
  vendorId: string
  originalMessage: string
  reason: string | null
  createdAt: string
  expiresAt: string
}

export function detectVendorRescheduleIntent(body: string): VendorRescheduleDetect {
  const text = body.trim()
  if (!text) return { isReschedule: false, confidence: 0, reason: null }
  if (!RESCHEDULE_INTENT.test(text)) {
    return { isReschedule: false, confidence: 0, reason: null }
  }
  const reason = extractRescheduleReason(text)
  let confidence = 0.85
  if (
    /\b(reschedule|re-?schedule|running\s+(?:late|behind|over)|won'?t\s+make|push\s+the)\b/i
      .test(text)
  ) {
    confidence = 0.95
  }
  return { isReschedule: true, confidence, reason }
}

function extractRescheduleReason(body: string): string | null {
  const m = body.match(
    /\b(running behind[^.!?]*(?:[.!?]|$)|running late[^.!?]*(?:[.!?]|$)|previous job[^.!?]*(?:[.!?]|$)|delayed[^.!?]*(?:[.!?]|$))/i,
  )
  if (!m?.[1]) return null
  return m[1].trim().replace(/\s+/g, " ").slice(0, 240)
}

export function readVendorReschedulePending(
  intakeState: Record<string, unknown> | null | undefined,
): VendorReschedulePending | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = intakeState[VENDOR_RESCHEDULE_PENDING_KEY]
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const vendorId = typeof row.vendorId === "string" ? row.vendorId.trim() : ""
  const originalMessage =
    typeof row.originalMessage === "string" ? row.originalMessage : ""
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : ""
  const expiresAt = typeof row.expiresAt === "string" ? row.expiresAt : ""
  if (!vendorId || !createdAt || !expiresAt) return null
  const exp = Date.parse(expiresAt)
  if (!Number.isFinite(exp) || exp <= Date.now()) return null
  return {
    ticketId: typeof row.ticketId === "string" && row.ticketId.trim()
      ? row.ticketId.trim()
      : null,
    vendorId,
    originalMessage,
    reason: typeof row.reason === "string" ? row.reason : null,
    createdAt,
    expiresAt,
  }
}

export async function persistVendorReschedulePending(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    pending: VendorReschedulePending | null
  },
): Promise<void> {
  const { data: convo } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()
  const intake =
    convo?.intake_state && typeof convo.intake_state === "object"
      ? { ...(convo.intake_state as Record<string, unknown>) }
      : {}
  if (!params.pending) {
    delete intake[VENDOR_RESCHEDULE_PENDING_KEY]
  } else {
    intake[VENDOR_RESCHEDULE_PENDING_KEY] = params.pending
  }
  await supabase
    .from("sms_conversations")
    .update({ intake_state: intake, updated_at: new Date().toISOString() })
    .eq("id", params.conversationId)
}

export function humanizeTrade(issueCategory: string | null | undefined): string {
  const raw = (issueCategory ?? "").trim().toLowerCase()
  if (!raw) return "vendor"
  const map: Record<string, string> = {
    plumbing: "plumber",
    electrical: "electrician",
    hvac: "HVAC technician",
    appliance: "appliance technician",
    general: "technician",
    carpentry: "carpenter",
    painting: "painter",
  }
  return map[raw] ?? raw.replace(/_/g, " ")
}

export function formatRescheduleTimeLabel(
  scheduledAt: string | null,
  windowText: string,
  timeZone = scheduleTimeZone(),
): string {
  const window = windowText.trim()
  if (scheduledAt) {
    try {
      const d = new Date(scheduledAt)
      if (!Number.isNaN(d.getTime())) {
        return new Intl.DateTimeFormat("en-US", {
          timeZone,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(d)
      }
    } catch {
      // fall through
    }
  }
  return window || "the new time"
}

export function buildVendorRescheduleConfirmSms(input: {
  workOrderRef: string
  newTimeLabel: string
  residentNotified: boolean
}): string {
  const wo = input.workOrderRef.trim() || "this work order"
  const when = input.newTimeLabel.trim() || "the new time"
  if (input.residentNotified) {
    return `Got it. I've rescheduled work order ${wo} to ${when}. The resident and property team will be notified.`
  }
  return `Work order ${wo} was rescheduled to ${when}. I couldn't reach the resident, so the property team has been notified.`
}

export function buildVendorRescheduleFailedSms(): string {
  return "I couldn't update the appointment yet. I've sent your request to the property team for review."
}

export function buildVendorRescheduleNeedTimeSms(workOrderRef?: string | null): string {
  const wo = workOrderRef?.trim()
  return wo
    ? `What time would you like to move work order ${wo} to?`
    : "What time would you like to move the appointment to?"
}

export function buildVendorRescheduleNeedDateSms(): string {
  return "Do you mean that time today or another day?"
}

export function buildResidentRescheduleNotifySms(input: {
  unitLabel: string
  tradeLabel: string
  newTimeLabel: string
}): string {
  const unit = input.unitLabel.trim() || "your unit"
  const trade = input.tradeLabel.trim() || "vendor"
  const when = input.newTimeLabel.trim() || "a new time"
  return (
    `Update for your repair in ${unit}: your ${trade} has rescheduled the visit to ${when}. ` +
    `Reply CONFIRM to acknowledge the new time, or contact the property team if this no longer works for you.`
  )
}

export function buildLandlordRescheduleSms(input: {
  workOrderRef: string
  newTimeLabel: string
}): string {
  return (
    `Work order ${input.workOrderRef} was rescheduled to ${input.newTimeLabel} by the vendor. ` +
    `The resident has been notified.`
  )
}

export function buildLandlordResidentDeclinedRescheduleSms(input: {
  unitLabel: string
  newTimeLabel: string
}): string {
  return (
    `The resident in ${input.unitLabel} cannot make the vendor’s proposed time of ${input.newTimeLabel}. ` +
    `Review the scheduling request.`
  )
}

export function buildVendorResidentConfirmedRescheduleSms(input: {
  workOrderRef: string
  newTimeLabel: string
}): string {
  return `The resident confirmed the new appointment for work order ${input.workOrderRef} at ${input.newTimeLabel}.`
}

export function buildLandlordRescheduleEmail(input: {
  workOrderRef: string
  vendorName: string
  propertyName: string
  unitLabel: string
  previousTimeLabel: string
  newTimeLabel: string
  reason: string | null
}): { subject: string; text: string; html: string } {
  const subject = `Work order rescheduled — ${input.workOrderRef}`
  const reasonLine = input.reason?.trim()
    ? `Reason: ${input.reason.trim()}`
    : "Reason: not provided"
  const text = [
    `${input.vendorName} rescheduled work order ${input.workOrderRef} for ${input.propertyName}, ${input.unitLabel}.`,
    "",
    `Previous time: ${input.previousTimeLabel}`,
    `New time: ${input.newTimeLabel}`,
    reasonLine,
    "",
    "The resident has been notified and is awaiting confirmation.",
  ].join("\n")
  const html =
    `<p>${escapeHtml(input.vendorName)} rescheduled work order <strong>${escapeHtml(input.workOrderRef)}</strong> for ${escapeHtml(input.propertyName)}, ${escapeHtml(input.unitLabel)}.</p>` +
    `<p>Previous time: ${escapeHtml(input.previousTimeLabel)}<br>New time: ${escapeHtml(input.newTimeLabel)}<br>${escapeHtml(reasonLine)}</p>` +
    `<p>The resident has been notified and is awaiting confirmation.</p>`
  return { subject, text, html }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export type RescheduleJob = VendorActiveJob & {
  scheduledAt: string | null
  scheduledWindowText: string | null
  vendorWorkStatus: string | null
  buildingName: string | null
}

/** Prefer jobs that already have an appointment on the books. */
export async function listVendorReschedulableJobs(
  supabase: SupabaseClient,
  vendorId: string,
): Promise<RescheduleJob[]> {
  const { data, error } = await supabase
    .from("maintenance_requests")
    .select(
      "id, unit, building, issue_category, description, created_at, scheduled_at, scheduled_window_text, vendor_work_status",
    )
    .eq("assigned_vendor_id", vendorId)
    .in("vendor_work_status", ["accepted", "in_progress", "pending_accept"])
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) {
    console.error("[vendor-reschedule] list jobs", error.message)
    return []
  }

  return ((data ?? []) as Array<Record<string, unknown>>)
    .map((row) => {
      const id = String(row.id)
      const status = typeof row.vendor_work_status === "string"
        ? row.vendor_work_status
        : null
      if (status && BLOCKED_STATUSES.has(status)) return null
      const scheduledAt =
        typeof row.scheduled_at === "string" ? row.scheduled_at : null
      const scheduledWindowText =
        typeof row.scheduled_window_text === "string"
          ? row.scheduled_window_text
          : null
      if (!scheduledAt && !scheduledWindowText?.trim()) return null
      return {
        ticketId: id,
        workOrderRef: formatWorkOrderRef(id),
        unit: typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : null,
        building:
          typeof row.building === "string" && row.building.trim()
            ? row.building.trim()
            : null,
        issueCategory:
          typeof row.issue_category === "string" && row.issue_category.trim()
            ? row.issue_category.trim()
            : null,
        description:
          typeof row.description === "string" && row.description.trim()
            ? row.description.trim()
            : null,
        scheduledAt,
        scheduledWindowText,
        vendorWorkStatus: status,
        buildingName:
          typeof row.building === "string" && row.building.trim()
            ? row.building.trim()
            : null,
      } satisfies RescheduleJob
    })
    .filter((j): j is RescheduleJob => j != null)
}

/** Narrow candidates when the vendor mentions an existing clock time (e.g. "the 10am"). */
export function filterJobsByExistingTimeHint(
  body: string,
  jobs: RescheduleJob[],
  timeZone = scheduleTimeZone(),
): RescheduleJob[] {
  const clock = body.match(
    /\b(?:the\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i,
  )
  if (!clock || jobs.length <= 1) return jobs
  const hour12 = Number(clock[1])
  const minute = clock[2] ? Number(clock[2]) : 0
  const ampm = clock[3].toLowerCase().replace(/\./g, "")
  if (!Number.isFinite(hour12) || hour12 < 1 || hour12 > 12) return jobs
  let hour24 = hour12 % 12
  if (ampm.startsWith("p")) hour24 += 12

  const hits = jobs.filter((job) => {
    if (job.scheduledAt) {
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone,
          hour: "numeric",
          minute: "2-digit",
          hour12: false,
        }).formatToParts(new Date(job.scheduledAt))
        const h = Number(parts.find((p) => p.type === "hour")?.value)
        const m = Number(parts.find((p) => p.type === "minute")?.value)
        if (h === hour24 && (minute === 0 || m === minute)) return true
      } catch {
        // fall through
      }
    }
    const window = (job.scheduledWindowText ?? "").toLowerCase()
    const needle = `${hour12}${minute ? `:${String(minute).padStart(2, "0")}` : ""}${ampm}`
    const loose = `${hour12}\\s*:?\\s*${minute ? String(minute).padStart(2, "0") + "\\s*" : ""}\\s*${ampm.charAt(0)}`
    return window.includes(needle) || new RegExp(loose, "i").test(window)
  })
  return hits.length > 0 ? hits : jobs
}

export function buildVendorRescheduleClarifySms(jobs: RescheduleJob[]): string {
  const lines = [
    "You have more than one active job that could match. Which one do you want to reschedule?",
    "",
  ]
  const tz = scheduleTimeZone()
  for (let i = 0; i < Math.min(jobs.length, 8); i++) {
    const job = jobs[i]
    const unit = job.unit ? `Apt ${job.unit}` : "Unit —"
    const place = job.buildingName ? `${job.buildingName}, ${unit}` : unit
    const when =
      job.scheduledWindowText?.trim() ||
      (job.scheduledAt
        ? formatRescheduleTimeLabel(job.scheduledAt, "", tz)
        : "unscheduled")
    lines.push(`${i + 1}. ${job.workOrderRef} — ${place} — ${when}`)
  }
  lines.push("")
  lines.push("Reply with 1, 2, or the work-order number.")
  return lines.join("\n")
}

async function alreadyProcessedInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string
    ticketId: string
  },
): Promise<boolean> {
  const key = `${params.conversationId}:${params.messageId}:${params.ticketId}`
  const since = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from("operations_graph_events")
    .select("id, metadata")
    .eq("landlord_id", params.landlordId)
    .eq("event_type", "maintenance.schedule_updated")
    .eq("maintenance_request_id", params.ticketId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20)

  for (const row of data ?? []) {
    const meta = row.metadata as Record<string, unknown> | null
    if (meta?.idempotency_key === key) return true
  }
  return false
}

async function notifyLandlordReschedule(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    workOrderRef: string
    vendorName: string
    unitLabel: string
    propertyName: string
    previousTimeLabel: string
    newTimeLabel: string
    reason: string | null
  },
): Promise<{ smsOk: boolean; emailOk: boolean }> {
  const smsBody = buildLandlordRescheduleSms({
    workOrderRef: params.workOrderRef,
    newTimeLabel: params.newTimeLabel,
  })
  const email = buildLandlordRescheduleEmail({
    workOrderRef: params.workOrderRef,
    vendorName: params.vendorName,
    propertyName: params.propertyName,
    unitLabel: params.unitLabel,
    previousTimeLabel: params.previousTimeLabel,
    newTimeLabel: params.newTimeLabel,
    reason: params.reason,
  })

  let smsOk = false
  const phones = (Deno.env.get("SMS_ADMIN_NOTIFY_PHONES") ?? "")
    .split(/[,;\s]+/)
    .map((p) => normalizePhoneFlexible(p))
    .filter((p): p is string => Boolean(p))

  if (phones.length > 0) {
    const sender = await findActiveLandlordMainNumber(supabase, params.landlordId)
    const from = sender?.phone_number?.trim()
    if (from) {
      const provider = getSMSProvider()
      for (const to of phones) {
        const send = await provider.sendMessage({ to, body: smsBody, from })
        if (!send.error) smsOk = true
      }
    }
  }

  const emailResult = await sendLandlordOpsEmail(supabase, {
    landlordId: params.landlordId,
    subject: email.subject,
    text: email.text,
    html: email.html,
    logLabel: "vendor-reschedule",
  })

  return { smsOk, emailOk: emailResult.sent.length > 0 }
}

async function notifyResidentReschedule(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    vendorConversationId: string
    landlordId: string
    unitLabel: string
    tradeLabel: string
    newTimeLabel: string
    windowText: string
    scheduledAt: string | null
    previousScheduledAt: string | null
    reason: string | null
  },
): Promise<{ ok: boolean; conversationId: string | null }> {
  const { data: ticket } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, unit, resident_name, resident_phone, resident_id",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  if (!ticket) return { ok: false, conversationId: null }

  const phoneE164 = normalizePhoneFlexible(
    typeof ticket.resident_phone === "string" ? ticket.resident_phone : null,
  )
  if (!phoneE164) return { ok: false, conversationId: null }

  const smsNumber = await findActiveLandlordMain(supabase, params.landlordId)
  if (!smsNumber?.phone_number) return { ok: false, conversationId: null }

  const provider = (smsNumber.provider === "telnyx" ? "telnyx" : "twilio") as SmsProviderName
  const residentId =
    typeof ticket.resident_id === "string" && ticket.resident_id.trim()
      ? ticket.resident_id.trim()
      : undefined

  const identity = await upsertSmsIdentityForPhone(supabase, {
    phone: phoneE164,
    landlordId: params.landlordId,
    identityType: "resident",
    residentId,
  })
  if (!identity) return { ok: false, conversationId: null }

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: smsNumber.id,
    externalPhone: phoneE164,
    identity,
    maintenanceRequestId: params.ticketId,
    conversationStatus: "open",
  })

  const body = buildResidentRescheduleNotifySms({
    unitLabel: params.unitLabel,
    tradeLabel: params.tradeLabel,
    newTimeLabel: params.newTimeLabel,
  })

  const sent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId: params.landlordId,
    fromNumber: smsNumber.phone_number,
    toNumber: phoneE164,
    body,
    provider,
    source: "tenant_reschedule_notify",
  })

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  const prior =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}

  await supabase
    .from("sms_conversations")
    .update({
      updated_at: new Date().toISOString(),
      status: "open",
      maintenance_request_id: params.ticketId,
      intake_state: {
        ...prior,
        [AWAITING_SCHEDULE_CONFIRM_KEY]: {
          ticket_id: params.ticketId,
          vendor_id: params.vendorId,
          vendor_conversation_id: params.vendorConversationId,
          window_text: params.windowText,
          scheduled_at: params.scheduledAt,
          kind: "reschedule",
          previous_scheduled_at: params.previousScheduledAt,
          reason: params.reason,
        },
      },
    })
    .eq("id", conversationId)

  const { error: logErr } = await supabase.from("resident_notification_log").insert({
    ticket_id: params.ticketId,
    event_type: "schedule_rescheduled",
    channel: "sms",
    error: sent.ok ? null : "send_failed",
  })
  if (logErr) {
    console.warn("[vendor-reschedule] resident log", logErr.message)
  }

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "maintenance.resident_reschedule_notified",
    source: "sms",
    actor_type: "system",
    vendor_id: params.vendorId,
    maintenance_request_id: params.ticketId,
    conversation_id: conversationId,
    metadata: {
      new_time: params.newTimeLabel,
      delivered: sent.ok,
    },
  })

  return { ok: sent.ok, conversationId }
}

function resolveNewScheduleFromBody(body: string): {
  scheduledAt: string | null
  windowText: string
  needsDateClarify: boolean
} {
  const tz = scheduleTimeZone()
  const resolved = parseAvailabilityResolved(body, new Date(), tz)
  if (resolved) {
    const windowText =
      resolved.entity?.display_text ||
      resolved.windowLabel ||
      body.trim()
    // Time-only without day cue → ask today vs another day when ambiguous
    const hasDayCue =
      /\b(today|tonight|tomorrow|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2})\b/i
        .test(body)
    const looksTimeOnly =
      !hasDayCue &&
      /^\s*(?:push(?:\s+it)?\s+to\s+|move(?:\s+it)?\s+to\s+|come\s+at\s+)?\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*$/i
        .test(body.trim())
    return {
      scheduledAt: resolved.scheduledAt,
      windowText,
      needsDateClarify: looksTimeOnly,
    }
  }
  const scheduledAt = parseAvailabilityToScheduledAt(body, new Date(), tz)
  return {
    scheduledAt,
    windowText: body.trim(),
    needsDateClarify: false,
  }
}

export type HandleVendorRescheduleResult =
  | {
      handled: true
      replyHint: string
      ticketId: string | null
      metadata: Record<string, unknown>
    }
  | { handled: false }

/**
 * Process a vendor SMS that requests a reschedule (or continues a pending one).
 */
export async function tryHandleVendorRescheduleSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    vendorId: string
    conversationId: string
    messageId: string
    inboundBody: string
    forcedTicketId?: string | null
    /** When true, treat as reschedule even without intent keywords (pending follow-up). */
    continuePending?: boolean
  },
): Promise<HandleVendorRescheduleResult> {
  const detected = detectVendorRescheduleIntent(params.inboundBody)
  if (!detected.isReschedule && !params.continuePending && !params.forcedTicketId) {
    return { handled: false }
  }
  if (!detected.isReschedule && !params.continuePending && params.forcedTicketId) {
    // Forced ticket from WO clarify only counts when original message was reschedule
    // (caller sets continuePending / passes original body with intent).
    if (!detectVendorRescheduleIntent(params.inboundBody).isReschedule) {
      return { handled: false }
    }
  }

  const confidence = detected.isReschedule ? detected.confidence : 0.7
  const reason = detected.reason

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "maintenance.vendor_reschedule_requested",
    source: "sms",
    actor_type: "vendor",
    actor_id: params.vendorId,
    vendor_id: params.vendorId,
    conversation_id: params.conversationId,
    message_id: params.messageId,
    metadata: {
      confidence,
      reason,
      body_preview: params.inboundBody.slice(0, 200),
      continue_pending: Boolean(params.continuePending),
    },
  })

  let jobs = await listVendorReschedulableJobs(supabase, params.vendorId)
  let ticketId = params.forcedTicketId?.trim() || null

  if (!ticketId) {
    if (jobs.length === 0) {
      return {
        handled: true,
        replyHint:
          "I don't see an active appointment assigned to you that can be rescheduled right now.",
        ticketId: null,
        metadata: { reason: "no_reschedulable_jobs" },
      }
    }

    jobs = filterJobsByExistingTimeHint(params.inboundBody, jobs)
    if (jobs.length === 1) {
      ticketId = jobs[0].ticketId
    } else {
      const asActive: VendorActiveJob[] = jobs.map((j) => ({
        ticketId: j.ticketId,
        workOrderRef: j.workOrderRef,
        unit: j.unit,
        building: j.building,
        issueCategory: j.issueCategory,
        description: j.description,
      }))
      const match = matchActiveJobsFromReply(params.inboundBody, asActive)
      if (match.kind === "unique") {
        ticketId = match.job.ticketId
      } else {
        const candidates = match.kind === "ambiguous" ? match.jobs : asActive
        const candidateJobs = jobs.filter((j) =>
          candidates.some((c) => c.ticketId === j.ticketId)
        )
        await persistVendorWorkOrderClarification(supabase, {
          conversationId: params.conversationId,
          clarification: createVendorWorkOrderClarification({
            vendorId: params.vendorId,
            conversationId: params.conversationId,
            landlordId: params.landlordId,
            originalMessage: params.inboundBody,
            originalIntent: "reschedule",
            candidateWorkOrderIds: candidateJobs.map((j) => j.ticketId),
          }),
        })
        await logGraphEvent(supabase, {
          landlord_id: params.landlordId,
          event_type: "maintenance.vendor_reschedule_clarification_requested",
          source: "sms",
          actor_type: "system",
          vendor_id: params.vendorId,
          conversation_id: params.conversationId,
          metadata: {
            candidate_ids: candidateJobs.map((j) => j.ticketId),
          },
        })
        return {
          handled: true,
          replyHint: buildVendorRescheduleClarifySms(candidateJobs),
          ticketId: null,
          metadata: { reason: "need_work_order_clarify" },
        }
      }
    }
  }

  if (!ticketId) return { handled: false }

  const { data: ticket, error: tErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, unit, building, issue_category, description, assigned_vendor_id, vendor_work_status, scheduled_at, scheduled_window_text, resident_phone, resident_name, resident_confirmation_status, schedule_status",
    )
    .eq("id", ticketId)
    .maybeSingle()

  if (tErr || !ticket) {
    return {
      handled: true,
      replyHint: buildVendorRescheduleFailedSms(),
      ticketId,
      metadata: { reason: "ticket_not_found" },
    }
  }

  if (ticket.assigned_vendor_id !== params.vendorId) {
    return {
      handled: true,
      replyHint:
        "That work order isn't assigned to you anymore, so I can't reschedule it from this thread.",
      ticketId,
      metadata: { reason: "not_assigned" },
    }
  }

  const status = String(ticket.vendor_work_status ?? "")
  if (BLOCKED_STATUSES.has(status)) {
    return {
      handled: true,
      replyHint:
        "That work order is already closed, so it can't be rescheduled by text.",
      ticketId,
      metadata: { reason: "job_closed", status },
    }
  }

  if (ticket.resident_confirmation_status === "declined") {
    // Allow a new vendor proposal after a prior decline — continue.
  }

  const parsed = resolveNewScheduleFromBody(params.inboundBody)
  const scheduledAt = parsed.scheduledAt
  const windowText = parsed.windowText

  if (!scheduledAt && !windowText.trim()) {
    const nowIso = new Date().toISOString()
    await persistVendorReschedulePending(supabase, {
      conversationId: params.conversationId,
      pending: {
        ticketId,
        vendorId: params.vendorId,
        originalMessage: params.inboundBody,
        reason,
        createdAt: nowIso,
        expiresAt: new Date(Date.now() + VENDOR_RESCHEDULE_PENDING_TTL_MS)
          .toISOString(),
      },
    })
    return {
      handled: true,
      replyHint: buildVendorRescheduleNeedTimeSms(formatWorkOrderRef(ticketId)),
      ticketId,
      metadata: { reason: "need_new_time" },
    }
  }

  if (parsed.needsDateClarify && scheduledAt) {
    const nowIso = new Date().toISOString()
    await persistVendorReschedulePending(supabase, {
      conversationId: params.conversationId,
      pending: {
        ticketId,
        vendorId: params.vendorId,
        originalMessage: params.inboundBody,
        reason,
        createdAt: nowIso,
        expiresAt: new Date(Date.now() + VENDOR_RESCHEDULE_PENDING_TTL_MS)
          .toISOString(),
      },
    })
    return {
      handled: true,
      replyHint: buildVendorRescheduleNeedDateSms(),
      ticketId,
      metadata: { reason: "need_date_clarify" },
    }
  }

  if (scheduledAt) {
    const when = Date.parse(scheduledAt)
    if (Number.isFinite(when) && when < Date.now() - 2 * 60 * 1000) {
      await persistVendorReschedulePending(supabase, {
        conversationId: params.conversationId,
        pending: {
          ticketId,
          vendorId: params.vendorId,
          originalMessage: params.inboundBody,
          reason,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + VENDOR_RESCHEDULE_PENDING_TTL_MS)
            .toISOString(),
        },
      })
      return {
        handled: true,
        replyHint:
          "That time looks like it's already in the past. What later time should I move the appointment to?",
        ticketId,
        metadata: { reason: "past_time" },
      }
    }
  }

  const lockedWindow =
    windowText.trim() ||
    formatRescheduleTimeLabel(scheduledAt, "", scheduleTimeZone())

  if (
    await alreadyProcessedInbound(supabase, {
      landlordId: params.landlordId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      ticketId,
    })
  ) {
    return {
      handled: true,
      replyHint: buildVendorRescheduleConfirmSms({
        workOrderRef: formatWorkOrderRef(ticketId),
        newTimeLabel: lockedWindow,
        residentNotified: true,
      }),
      ticketId,
      metadata: { reason: "idempotent_replay" },
    }
  }

  const previousScheduledAt =
    typeof ticket.scheduled_at === "string" ? ticket.scheduled_at : null
  const previousWindow =
    typeof ticket.scheduled_window_text === "string"
      ? ticket.scheduled_window_text
      : null
  const nowIso = new Date().toISOString()
  const idempotencyKey =
    `${params.conversationId}:${params.messageId}:${ticketId}`

  const { error: upErr } = await supabase
    .from("maintenance_requests")
    .update({
      previous_scheduled_at: previousScheduledAt,
      previous_scheduled_window_text: previousWindow,
      scheduled_at: scheduledAt,
      scheduled_window_text: lockedWindow,
      schedule_confirmed_at: null,
      reschedule_requested_by: "vendor",
      reschedule_reason: reason,
      reschedule_requested_at: nowIso,
      resident_confirmation_status: "pending",
      resident_confirmed_at: null,
      schedule_status: "vendor_rescheduled_pending_resident",
      vendor_work_status: status === "pending_accept" ? "accepted" : status,
    })
    .eq("id", ticketId)
    .eq("assigned_vendor_id", params.vendorId)

  if (upErr) {
    console.error("[vendor-reschedule] update failed", upErr.message)
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "maintenance.reschedule_notification_failed",
      source: "sms",
      actor_type: "system",
      vendor_id: params.vendorId,
      maintenance_request_id: ticketId,
      metadata: { stage: "db_update", error: upErr.message },
    })
    return {
      handled: true,
      replyHint: buildVendorRescheduleFailedSms(),
      ticketId,
      metadata: { reason: "update_failed" },
    }
  }

  await persistVendorReschedulePending(supabase, {
    conversationId: params.conversationId,
    pending: null,
  })
  await persistVendorWorkOrderClarification(supabase, {
    conversationId: params.conversationId,
    clarification: null,
  })

  const workOrderRef = formatWorkOrderRef(ticketId)
  const tz = scheduleTimeZone()
  const newTimeLabel = formatRescheduleTimeLabel(scheduledAt, lockedWindow, tz)
  const previousTimeLabel = formatRescheduleTimeLabel(
    previousScheduledAt,
    previousWindow ?? "",
    tz,
  )
  const unitLabel = typeof ticket.unit === "string" && ticket.unit.trim()
    ? `Apt ${ticket.unit.trim()}`
    : "your unit"
  const propertyName =
    typeof ticket.building === "string" && ticket.building.trim()
      ? ticket.building.trim()
      : "your property"

  const { data: vendor } = await supabase
    .from("vendors")
    .select("name, category")
    .eq("id", params.vendorId)
    .maybeSingle()
  const vendorName = vendorCompanyName(
    typeof vendor?.name === "string" ? vendor.name : "Vendor",
  )
  const tradeLabel = humanizeTrade(
    (typeof ticket.issue_category === "string" ? ticket.issue_category : null) ||
      (typeof vendor?.category === "string" ? vendor.category : null),
  )

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "maintenance.schedule_updated",
    source: "sms",
    actor_type: "vendor",
    actor_id: params.vendorId,
    vendor_id: params.vendorId,
    maintenance_request_id: ticketId,
    conversation_id: params.conversationId,
    message_id: params.messageId,
    metadata: {
      idempotency_key: idempotencyKey,
      previous_scheduled_at: previousScheduledAt,
      scheduled_at: scheduledAt,
      window_text: lockedWindow,
      reason,
      confidence,
    },
  })

  await logGraphEvent(supabase, {
    landlord_id: params.landlordId,
    event_type: "maintenance.vendor_reschedule_resolved",
    source: "sms",
    actor_type: "system",
    vendor_id: params.vendorId,
    maintenance_request_id: ticketId,
    conversation_id: params.conversationId,
    metadata: { new_time: newTimeLabel },
  })

  const resident = await notifyResidentReschedule(supabase, {
    ticketId,
    vendorId: params.vendorId,
    vendorConversationId: params.conversationId,
    landlordId: params.landlordId,
    unitLabel,
    tradeLabel,
    newTimeLabel,
    windowText: lockedWindow,
    scheduledAt,
    previousScheduledAt,
    reason,
  })

  const landlord = await notifyLandlordReschedule(supabase, {
    landlordId: params.landlordId,
    workOrderRef,
    vendorName,
    unitLabel,
    propertyName,
    previousTimeLabel: previousTimeLabel || "not set",
    newTimeLabel,
    reason,
  })

  if (!resident.ok) {
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "maintenance.reschedule_notification_failed",
      source: "sms",
      actor_type: "system",
      vendor_id: params.vendorId,
      maintenance_request_id: ticketId,
      metadata: {
        channel: "resident_sms",
        landlord_sms: landlord.smsOk,
        landlord_email: landlord.emailOk,
      },
    })
  }

  try {
    const next = {
      ...createIdleScheduleState(ticketId),
      step: "scheduled" as const,
      ticketId,
      pendingWindowText: lockedWindow,
      pendingScheduledAt: scheduledAt,
    }
    await persistVendorScheduleFsm(supabase, {
      conversationId: params.conversationId,
      ticketId,
      next,
    })
  } catch (e) {
    console.warn("[vendor-reschedule] fsm sync", e)
  }

  return {
    handled: true,
    replyHint: buildVendorRescheduleConfirmSms({
      workOrderRef,
      newTimeLabel,
      residentNotified: resident.ok,
    }),
    ticketId,
    metadata: {
      reason: "rescheduled",
      residentNotified: resident.ok,
      landlordSms: landlord.smsOk,
      landlordEmail: landlord.emailOk,
      newTimeLabel,
    },
  }
}
