import {
  addScheduleQuestion,
  questionStillOpen,
  removeScheduleQuestion,
  scheduleQuestions,
  selectScheduleQuestion,
} from "./questionReplyRef.ts"
/**
 * Ask the resident to approve a vendor-proposed appointment window before
 * locking the schedule and sending the vendor job-detail link.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { normalizePhoneFlexible } from "../resident_notify.ts"
import { ensureResidentRequestRef } from "./residentRequestRef.ts"
import { confirmVendorSchedule } from "../vendor_job_schedule.ts"
import {
  buildResidentScheduleAlreadyAdvancedSms,
  ticketStatusBlocksScheduleAsks,
} from "../scheduleAskGuards.ts"
import {
  appendOutboundContext,
  persistVendorScheduleFsm,
  readVendorScheduleFsm,
  reduceScheduleFsm,
} from "../vendor_schedule_fsm.ts"
import { sendInboundAutoReply } from "./inboundReply.ts"
import {
  findOrCreateConversation,
  findResidentConversationByPhone,
  upsertSmsIdentityForPhone,
} from "./inbound_db.ts"
import { findActiveLandlordMainNumber } from "./landlordSmsOnboarding.ts"
import { logOutboundNoLandlordMain } from "./logOutboundNoLandlordMain.ts"
import type { SmsProviderName } from "./types.ts"
import {
  buildLandlordResidentDeclinedRescheduleSms,
  buildVendorResidentConfirmedRescheduleSms,
  formatRescheduleTimeLabel,
} from "./vendorRescheduleSms.ts"
import { getSMSProviderForSend } from "./providerFactory.ts"
import {
  extractTenantSchedulePreferredWindow,
  hasTenantScheduleTimeCue,
} from "./tenantSchedulePreferredWindow.ts"
import { matchShortReplyToken } from "./shortReplyTokens.ts"
import { landlordRecipients, recordSmsNoRecipients } from "../smsRecipients.ts"

export {
  extractTenantSchedulePreferredWindow,
  hasTenantScheduleTimeCue,
} from "./tenantSchedulePreferredWindow.ts"

export const AWAITING_SCHEDULE_CONFIRM_KEY = "awaiting_schedule_confirmation"

export type TenantScheduleDecision = "accept" | "decline" | "counter_propose"

type AwaitingScheduleConfirmation = {
  ticketId: string
  vendorId: string
  vendorConversationId: string | null
  windowText: string
  scheduledAt: string | null
  kind: "initial" | "reschedule"
}

function firstName(name: string): string {
  const part = name.trim().split(/\s+/)[0]
  return part || "there"
}

export function buildTenantScheduleAskSms(input: {
  residentName: string
  vendorName: string
  windowText: string
  /** Short request ref, only when another visit is also waiting. */
  choiceRef?: string
  workOrderRef?: string
}): string {
  const who = firstName(input.residentName)
  const vendor = input.vendorName.trim() || "the vendor"
  const when = input.windowText.trim() || "the time they shared"
  const choice = input.choiceRef?.trim()
  return [
    `Hi ${who},`,
    "",
    `${vendor} proposed an arrival window of ${when}. Does that work for you?`,
    "",
    choice
      ? `Reply ${choice} YES to confirm this visit, or ${choice} NO with another day/time.`
      : "Reply YES to confirm, or NO with another day/time (e.g. Thu 2–4pm).",
    ...(input.workOrderRef ? [input.workOrderRef] : []),
  ].join("\n")
}

/** "No. Can they come later on the same day?" */
export function isLaterSameDayCounter(body: string): boolean {
  return /\blater\b/i.test(body) && /\bsame day\b/i.test(body)
}

export function dayLabelFromWindow(windowText: string): string {
  const match = windowText.match(
    /\b(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i,
  )
  if (!match) return "that day"
  const key = match[1].slice(0, 3).toLowerCase()
  const days: Record<string, string> = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  }
  return days[key] ?? "that day"
}

export function buildVendorLaterSameDaySms(windowText: string): string {
  const when = windowText.trim() || "that time"
  return `The resident can't do ${when}. Can you come later the same day? Reply with a window.`
}

export function buildTenantLaterSameDayAckSms(input: {
  vendorName: string
  dayLabel: string
}): string {
  const vendor = input.vendorName.trim() || "the vendor"
  const day = input.dayLabel.trim() || "that day"
  return `I've asked ${vendor} for a later time on ${day} and will text you when they reply.`
}

export function buildTenantScheduleAcceptedSms(windowText: string): string {
  const when = windowText.trim() || "the window you confirmed"
  return `Thanks — you're confirmed for ${when}. We'll keep you updated on the repair.`
}

export function buildTenantScheduleDeclinedSms(
  preferredWindowText?: string | null,
): string {
  const preferred = preferredWindowText?.trim()
  if (preferred) {
    return (
      `Got it — we'll share ${preferred} with the vendor and text you when they reply.`
    )
  }
  return "No problem — we'll ask the vendor for another time and text you again."
}

export function buildVendorWaitingOnTenantSms(windowText: string): string {
  const when = windowText.trim() || "that time"
  return `Thanks — checking with the resident on ${when}. We'll text you once they confirm.`
}

export function buildVendorTenantNeedsDifferentTimeSms(
  preferredWindowText?: string | null,
): string {
  const preferred = preferredWindowText?.trim()
  if (preferred) {
    return [
      "The resident needs a different arrival window.",
      `They suggested: ${preferred}.`,
      "",
      "Reply with a day and arrival window that works (confirm that one or offer another).",
    ].join("\n")
  }
  return (
    "The resident needs a different arrival window. " +
    "What's another day and window that works (e.g. Thu 1pm–4pm)?"
  )
}

export function parseTenantScheduleDecision(
  body: string,
): TenantScheduleDecision | null {
  const trimmed = body.trim()
  if (!trimmed) return null

  const normalized = trimmed
    .toUpperCase()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")

  if (
    normalized === "YES" ||
    normalized === "Y" ||
    normalized === "CONFIRM" ||
    normalized === "CONFIRMED" ||
    normalized === "WORKS" ||
    normalized === "THAT WORKS" ||
    normalized === "OK" ||
    normalized === "OKAY"
  ) {
    return "accept"
  }

  const declinePhrase =
    normalized === "NO" ||
    normalized === "N" ||
    normalized === "NOPE" ||
    normalized === "NAH" ||
    normalized === "DECLINE" ||
    normalized === "DECLINED" ||
    normalized === "DIFFERENT TIME" ||
    normalized === "DOESN'T WORK" ||
    normalized === "DOES NOT WORK" ||
    normalized === "THAT TIME DOESN'T WORK" ||
    normalized === "THAT TIME DOES NOT WORK" ||
    normalized === "WON'T BE HOME" ||
    normalized === "I WON'T BE HOME" ||
    /\b(doesn'?t work|does not work|won'?t be home|cannot make|can'?t make)\b/i
      .test(trimmed)

  // "No Wed 2pm" / "No, tomorrow after 3" — decline lead-in + alternate window.
  if (
    /^(?:no|n|nope|nah)\b/i.test(trimmed) &&
    hasTenantScheduleTimeCue(trimmed)
  ) {
    return "counter_propose"
  }

  if (declinePhrase) {
    // Counter-propose when they offer another day/time with the decline.
    if (hasTenantScheduleTimeCue(trimmed)) {
      return "counter_propose"
    }
    return "decline"
  }

  if (
    /\b(can they come|come tomorrow|another (?:day|time)|different (?:day|time)|how about|what about)\b/i
      .test(trimmed)
  ) {
    return "counter_propose"
  }

  // Typo tolerance for short YES/NO command tokens (in addition to phrases above).
  const acceptHit = matchShortReplyToken(normalized, [
    "YES",
    "Y",
    "CONFIRM",
    "CONFIRMED",
    "OK",
    "OKAY",
  ])
  if (acceptHit) return "accept"
  const declineHit = matchShortReplyToken(normalized, [
    "NO",
    "N",
    "NOPE",
    "NAH",
    "DECLINE",
    "DECLINED",
  ])
  if (declineHit) return "decline"

  return null
}

export function buildScheduleConfirmClarifySms(input: {
  windowText?: string | null
  workOrderRef?: string | null
}): string {
  const window = input.windowText?.trim() || ""
  const wo = input.workOrderRef?.trim() || ""
  if (window && wo) {
    return (
      `I didn't quite catch that — did you mean to confirm ${window} for ${wo}? ` +
      "Reply YES or NO."
    )
  }
  if (window) {
    return (
      `I didn't quite catch that — did you mean to confirm ${window}? Reply YES or NO.`
    )
  }
  return "I didn't quite catch that — reply YES to confirm the visit time, or NO if you need a different window."
}

function readAwaitingScheduleConfirmation(
  intakeState: unknown,
): AwaitingScheduleConfirmation | null {
  if (!intakeState || typeof intakeState !== "object") return null
  const raw = (intakeState as Record<string, unknown>)[AWAITING_SCHEDULE_CONFIRM_KEY]
  if (!raw || typeof raw !== "object") return null
  const row = raw as Record<string, unknown>
  const ticketId =
    (typeof row.ticket_id === "string" && row.ticket_id.trim()) ||
    (typeof row.ticketId === "string" && row.ticketId.trim()) ||
    ""
  const vendorId =
    (typeof row.vendor_id === "string" && row.vendor_id.trim()) ||
    (typeof row.vendorId === "string" && row.vendorId.trim()) ||
    ""
  const windowText =
    (typeof row.window_text === "string" && row.window_text.trim()) ||
    (typeof row.windowText === "string" && row.windowText.trim()) ||
    ""
  if (!ticketId || !vendorId || !windowText) return null
  const vendorConversationId =
    (typeof row.vendor_conversation_id === "string" &&
      row.vendor_conversation_id.trim()) ||
    (typeof row.vendorConversationId === "string" &&
      row.vendorConversationId.trim()) ||
    null
  const scheduledAt =
    (typeof row.scheduled_at === "string" && row.scheduled_at.trim()) ||
    (typeof row.scheduledAt === "string" && row.scheduledAt.trim()) ||
    null
  const kind = row.kind === "reschedule" ? "reschedule" : "initial"
  return {
    ticketId,
    vendorId,
    vendorConversationId,
    windowText,
    scheduledAt,
    kind,
  }
}

async function clearAwaitingScheduleConfirmation(
  supabase: SupabaseClient,
  conversationId: string,
  priorIntake: Record<string, unknown>,
  question?: Record<string, unknown>,
): Promise<void> {
  const next = removeScheduleQuestion(
    priorIntake,
    question ??
      priorIntake[AWAITING_SCHEDULE_CONFIRM_KEY] as Record<string, unknown>,
  )
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
}

async function resolveResidentScheduleConversation(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    smsNumberId: string
    phoneE164: string
    identity: Parameters<typeof findOrCreateConversation>[1]["identity"]
    residentId: string | null
    ticketId: string
  },
): Promise<string> {
  // findOrCreateConversation only matches a few open statuses. A resident who
  // already has a thread (including a completed reminder thread) must get the
  // pending ask on THAT conversation, or their YES lands with no schedule flag.
  const existing = await findResidentConversationByPhone(supabase, {
    landlordId: params.landlordId,
    smsNumberId: params.smsNumberId,
    externalPhone: params.phoneE164,
    residentId: params.residentId,
  })
  if (existing?.id) return existing.id

  if (params.residentId) {
    const { data } = await supabase
      .from("sms_conversations")
      .select("id")
      .eq("landlord_id", params.landlordId)
      .eq("resident_id", params.residentId)
      .is("vendor_id", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    const id = typeof data?.id === "string" ? data.id : ""
    if (id) return id
  }

  const created = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: params.smsNumberId,
    externalPhone: params.phoneE164,
    identity: params.identity,
    maintenanceRequestId: params.ticketId,
    conversationStatus: "open",
  })
  return created.conversationId
}

async function writeAwaitingScheduleConfirmation(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    ticketId: string
    pending: Record<string, unknown>
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: conv, error: readErr } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()
  if (readErr || !conv) {
    return { ok: false, error: readErr?.message ?? "conversation_missing" }
  }
  const prior =
    conv.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}
  const { error } = await supabase
    .from("sms_conversations")
    .update({
      updated_at: new Date().toISOString(),
      status: "open",
      maintenance_request_id: params.ticketId,
      intake_state: addScheduleQuestion(prior, params.pending),
    })
    .eq("id", params.conversationId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Ask the resident if the vendor's proposed window works. */
export async function askTenantScheduleConfirmation(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    vendorId: string
    vendorConversationId: string | null
    windowText: string
    scheduledAt: string | null
  },
): Promise<{ ok: boolean; conversationId: string | null; error?: string }> {
  const { data: ticket, error: tErr } = await supabase
    .from("maintenance_requests")
    .select(
      "id, landlord_id, unit, resident_name, resident_phone, email, resident_id",
    )
    .eq("id", params.ticketId)
    .maybeSingle()

  if (tErr || !ticket) {
    return { ok: false, conversationId: null, error: "ticket_not_found" }
  }

  const landlordId =
    typeof ticket.landlord_id === "string" ? ticket.landlord_id.trim() : ""
  if (!landlordId) {
    return { ok: false, conversationId: null, error: "missing_landlord" }
  }

  const phoneE164 = normalizePhoneFlexible(
    typeof ticket.resident_phone === "string" ? ticket.resident_phone : null,
  )
  if (!phoneE164) {
    return { ok: false, conversationId: null, error: "no_resident_phone" }
  }

  const { data: vendor } = await supabase
    .from("vendors")
    .select("name")
    .eq("id", params.vendorId)
    .maybeSingle()
  const vendorName =
    typeof vendor?.name === "string" && vendor.name.trim()
      ? vendor.name.trim()
      : "The vendor"

  const smsNumber = await findActiveLandlordMainNumber(supabase, landlordId)
  if (!smsNumber?.phone_number) {
    await logOutboundNoLandlordMain(supabase, {
      landlordId,
      messageType: "tenant_schedule_ask",
      resolver: "findActiveLandlordMainNumber",
      ticketId: params.ticketId,
      vendorId: params.vendorId,
      residentId:
        typeof ticket.resident_id === "string" ? ticket.resident_id : null,
    })
    return { ok: false, conversationId: null, error: "no_landlord_main" }
  }

  const provider: SmsProviderName = "twilio"
  const residentId =
    typeof ticket.resident_id === "string" && ticket.resident_id.trim()
      ? ticket.resident_id.trim()
      : undefined

  const identity = await upsertSmsIdentityForPhone(supabase, {
    phone: phoneE164,
    landlordId,
    identityType: "resident",
    residentId,
  })
  if (!identity) {
    return { ok: false, conversationId: null, error: "identity_failed" }
  }

  const conversationId = await resolveResidentScheduleConversation(supabase, {
    landlordId,
    smsNumberId: smsNumber.id,
    phoneE164,
    identity,
    residentId: residentId ?? null,
    ticketId: params.ticketId,
  })

  const replyRef = `S-${
    crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()
  }`
  const requestRef = await ensureResidentRequestRef(supabase, params.ticketId)
  const { data: priorThread } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .eq("landlord_id", landlordId)
    .maybeSingle()
  const priorIntake =
    priorThread?.intake_state && typeof priorThread.intake_state === "object"
      ? priorThread.intake_state as Record<string, unknown>
      : {}
  const now = Date.now()
  const otherOpenVisits = scheduleQuestions(priorIntake).filter((question) => {
    const ticket = String(question.ticket_id ?? question.ticketId ?? "")
    return ticket !== params.ticketId && questionStillOpen(question, now)
  })
  const body = buildTenantScheduleAskSms({
    choiceRef: otherOpenVisits.length > 0 ? requestRef : undefined,
    workOrderRef: `Ref: ${requestRef}`,
    residentName: String(ticket.resident_name ?? ""),
    vendorName,
    windowText: params.windowText,
  })

  const pendingAsk = {
    reply_ref: replyRef,
    request_ref: requestRef,
    expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    ticket_id: params.ticketId,
    vendor_id: params.vendorId,
    vendor_conversation_id: params.vendorConversationId,
    window_text: params.windowText,
    scheduled_at: params.scheduledAt,
    kind: "initial" as const,
  }
  const wrote = await writeAwaitingScheduleConfirmation(supabase, {
    conversationId,
    ticketId: params.ticketId,
    pending: pendingAsk,
  })
  if (!wrote.ok) {
    console.error(
      "[tenant-schedule] awaiting_schedule_confirmation was not saved on the resident thread",
      wrote.error,
    )
    return { ok: false, conversationId, error: "intake_write_failed" }
  }

  const sent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId,
    fromNumber: smsNumber.phone_number,
    toNumber: phoneE164,
    body,
    provider,
    source: "tenant_schedule_ask",
  })

  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: "maintenance.schedule_tenant_ask",
    source: "sms",
    actor_type: "system",
    resident_id: residentId ?? null,
    vendor_id: params.vendorId,
    maintenance_request_id: params.ticketId,
    conversation_id: conversationId,
    metadata: {
      window_text: params.windowText,
      sms_delivered: sent.ok,
    },
  })

  return {
    ok: sent.ok,
    conversationId,
    error: sent.ok ? undefined : sent.error,
  }
}

async function notifyVendorOnThread(
  supabase: SupabaseClient,
  params: {
    conversationId: string | null
    ticketId: string
    vendorId: string
    body: string
  },
): Promise<void> {
  if (!params.conversationId || !params.body.trim()) return

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state, landlord_id, sms_number_id, external_phone_number")
    .eq("id", params.conversationId)
    .maybeSingle()
  if (!conv) return

  const landlordId =
    typeof conv.landlord_id === "string" ? conv.landlord_id.trim() : ""
  const to =
    typeof conv.external_phone_number === "string"
      ? conv.external_phone_number.trim()
      : ""
  if (!landlordId || !to) return

  const smsNumber = await findActiveLandlordMainNumber(supabase, landlordId)
  if (!smsNumber?.phone_number) {
    await logOutboundNoLandlordMain(supabase, {
      landlordId,
      messageType: "tenant_schedule_vendor_update",
      resolver: "findActiveLandlordMainNumber",
      ticketId: params.ticketId,
      vendorId: params.vendorId,
      conversationId: params.conversationId,
    })
    return
  }

  const provider: SmsProviderName = "twilio"
  await sendInboundAutoReply(supabase, {
    conversationId: params.conversationId,
    landlordId,
    fromNumber: smsNumber.phone_number,
    toNumber: to,
    body: params.body,
    provider,
    source: "tenant_schedule_vendor_update",
  })

  const intake =
    conv.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}
  const prev = readVendorScheduleFsm(intake)
  if (!prev) return
  const at = new Date().toISOString()
  const withOut = appendOutboundContext(prev, params.body, at)
  await persistVendorScheduleFsm(supabase, {
    conversationId: params.conversationId,
    ticketId: params.ticketId,
    next: withOut,
  })
}

async function notifyLandlordOpsSms(
  supabase: SupabaseClient,
  landlordId: string,
  body: string,
  opts?: { messageType?: string; ticketId?: string | null },
): Promise<void> {
  const { phones } = await landlordRecipients(supabase, landlordId)
  if (phones.length === 0) {
    await recordSmsNoRecipients({
      supabase,
      landlordId,
      caller: "tenantScheduleConfirm.notifyLandlordOpsSms",
      messageType: opts?.messageType ?? "landlord_schedule_update",
      maintenanceRequestId: opts?.ticketId ?? null,
    })
    return
  }
  const sender = await findActiveLandlordMainNumber(supabase, landlordId)
  const from = sender?.phone_number?.trim()
  if (!from) return
  const provider = getSMSProviderForSend({
    landlordId,
    lineProvider: sender!.provider,
  })
  for (const to of phones) {
    await provider.sendMessage({ to, body, from })
  }
}

/** Handle resident YES/NO while a proposed appointment is pending. */
export async function tryHandleTenantScheduleConfirmInbound(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string
    body: string
    identityType: string
  },
): Promise<
  | {
      handled: true
      action: TenantScheduleDecision
      ticketId: string
      replyBody: string
    }
  | {
      handled: true
      clarified: true
      ticketId: string
      replyBody: string
    }
  | { handled: false }
> {
  if (params.identityType !== "resident") return { handled: false }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("id, intake_state, maintenance_request_id")
    .eq("id", params.conversationId)
    .eq("landlord_id", params.landlordId)
    .maybeSingle()
  if (!conv) return { handled: false }

  const prior = conv.intake_state && typeof conv.intake_state === "object"
    ? (conv.intake_state as Record<string, unknown>)
    : {}
  const selected = selectScheduleQuestion(prior, params.body)
  if (selected.kind === "clarify") {
    return {
      handled: true,
      clarified: true,
      ticketId: "",
      replyBody: selected.body,
    }
  }
  if (selected.kind === "none") return { handled: false }
  const pending = readAwaitingScheduleConfirmation({
    [AWAITING_SCHEDULE_CONFIRM_KEY]: selected.question,
  })
  if (!pending) return { handled: false }
  const replyBody = selected.body

  const { data: ticketRow } = await supabase
    .from("maintenance_requests")
    .select("vendor_work_status, assigned_vendor_id")
    .eq("landlord_id", params.landlordId)
    .eq("id", pending.ticketId)
    .maybeSingle()
  if (!ticketRow) {
    return {
      handled: true,
      clarified: true,
      ticketId: pending.ticketId,
      replyBody:
        "I couldn't verify that visit on your account. Please ask for a fresh visit proposal; I haven't changed the schedule.",
    }
  }
  const workStatus = typeof ticketRow?.vendor_work_status === "string"
    ? ticketRow.vendor_work_status
    : ""
  if (ticketStatusBlocksScheduleAsks(workStatus)) {
    await clearAwaitingScheduleConfirmation(
      supabase,
      params.conversationId,
      prior,
      selected.question,
    )
    return {
      handled: true,
      clarified: true,
      ticketId: pending.ticketId,
      replyBody: buildResidentScheduleAlreadyAdvancedSms({
        workOrderRef: `Ref: ${await ensureResidentRequestRef(supabase, pending.ticketId)}`,
      }),
    }
  }

  if (
    (ticketRow.assigned_vendor_id &&
      ticketRow.assigned_vendor_id !== pending.vendorId) ||
    (pending.scheduledAt && Date.parse(pending.scheduledAt) <= Date.now())
  ) {
    return {
      handled: true,
      clarified: true,
      ticketId: pending.ticketId,
      replyBody:
        "That visit proposal is no longer current. Please ask the property team for a fresh proposal; I haven't changed the schedule.",
    }
  }

  // While a window is pending, bare day/time (or "No Wed 2pm") is a counter-propose.
  let decision = parseTenantScheduleDecision(replyBody)
  if (!decision && hasTenantScheduleTimeCue(replyBody)) {
    decision = "counter_propose"
  }
  if (!decision) {
    // Keep the pending ask — never fall through to a generic maintenance greeting.
    return {
      handled: true,
      clarified: true,
      ticketId: pending.ticketId,
      replyBody: buildScheduleConfirmClarifySms({
        windowText: pending.windowText,
        workOrderRef: `Ref: ${await ensureResidentRequestRef(supabase, pending.ticketId)}`,
      }),
    }
  }

  const preferredWindow = decision === "counter_propose"
    ? extractTenantSchedulePreferredWindow(replyBody)
    : null

  await clearAwaitingScheduleConfirmation(
    supabase,
    params.conversationId,
    prior,
    selected.question,
  )

  const at = new Date().toISOString()
  const isReschedule = pending.kind === "reschedule"
  const workOrderRef = `Ref: ${await ensureResidentRequestRef(supabase, pending.ticketId)}`
  const newTimeLabel = formatRescheduleTimeLabel(
    pending.scheduledAt,
    pending.windowText,
  )

  if (decision === "accept") {
    if (pending.vendorConversationId) {
      const { data: vendorConv } = await supabase
        .from("sms_conversations")
        .select("intake_state")
        .eq("id", pending.vendorConversationId)
        .maybeSingle()
      const vendorIntake =
        vendorConv?.intake_state && typeof vendorConv.intake_state === "object"
          ? (vendorConv.intake_state as Record<string, unknown>)
          : {}
      const prev = readVendorScheduleFsm(vendorIntake)
      const reduced = reduceScheduleFsm(prev, { type: "TENANT_YES", at })
      await persistVendorScheduleFsm(supabase, {
        conversationId: pending.vendorConversationId,
        ticketId: pending.ticketId,
        next: reduced.state,
      })
    }

    if (isReschedule) {
      await supabase
        .from("maintenance_requests")
        .update({
          resident_confirmation_status: "confirmed",
          resident_confirmed_at: at,
          schedule_status: "scheduled_confirmed",
          schedule_confirmed_at: at,
          scheduled_window_text: pending.windowText,
          scheduled_at: pending.scheduledAt,
        })
        .eq("id", pending.ticketId)

      if (pending.vendorConversationId) {
        await notifyVendorOnThread(supabase, {
          conversationId: pending.vendorConversationId,
          ticketId: pending.ticketId,
          vendorId: pending.vendorId,
          body: buildVendorResidentConfirmedRescheduleSms({
            workOrderRef,
            newTimeLabel,
          }),
        })
      }

      await logGraphEvent(supabase, {
        landlord_id: params.landlordId,
        event_type: "maintenance.resident_reschedule_confirmed",
        source: "sms",
        actor_type: "resident",
        vendor_id: pending.vendorId,
        maintenance_request_id: pending.ticketId,
        conversation_id: params.conversationId,
        message_id: params.messageId,
        metadata: { window_text: pending.windowText, new_time: newTimeLabel },
      })
    } else {
      const confirmed = await confirmVendorSchedule(supabase, {
        ticketId: pending.ticketId,
        vendorId: pending.vendorId,
        conversationId: pending.vendorConversationId,
        windowText: pending.windowText,
        scheduledAt: pending.scheduledAt,
        skipResidentNotify: true,
      })

      if (confirmed.ok && pending.vendorConversationId) {
        await notifyVendorOnThread(supabase, {
          conversationId: pending.vendorConversationId,
          ticketId: pending.ticketId,
          vendorId: pending.vendorId,
          body: confirmed.replyHint,
        })
      }

      await logGraphEvent(supabase, {
        landlord_id: params.landlordId,
        event_type: "maintenance.schedule_tenant_accepted",
        source: "sms",
        actor_type: "resident",
        vendor_id: pending.vendorId,
        maintenance_request_id: pending.ticketId,
        conversation_id: params.conversationId,
        message_id: params.messageId,
        metadata: { window_text: pending.windowText, confirm_ok: confirmed.ok },
      })
    }

    return {
      handled: true,
      action: "accept",
      ticketId: pending.ticketId,
      replyBody: `${buildTenantScheduleAcceptedSms(pending.windowText)} ${workOrderRef}`.trim(),
    }
  }

  // decline or counter-propose
  const confirmationStatus =
    decision === "counter_propose" ? "counter_proposed" : "declined"

  const ticketUpdate: Record<string, unknown> = {}
  if (isReschedule) {
    ticketUpdate.resident_confirmation_status = confirmationStatus
    ticketUpdate.schedule_status = "resident_declined_reschedule"
    ticketUpdate.schedule_confirmed_at = null
  }
  if (preferredWindow) {
    ticketUpdate.resident_availability_text = preferredWindow
  }
  if (Object.keys(ticketUpdate).length > 0) {
    await supabase
      .from("maintenance_requests")
      .update(ticketUpdate)
      .eq("id", pending.ticketId)
  }

  const laterSameDay = decision === "counter_propose" &&
    isLaterSameDayCounter(replyBody)
  let laterSameDayReply: string | null = null

  if (pending.vendorConversationId) {
    const { data: vendorConv } = await supabase
      .from("sms_conversations")
      .select("intake_state")
      .eq("id", pending.vendorConversationId)
      .maybeSingle()
    const vendorIntake =
      vendorConv?.intake_state && typeof vendorConv.intake_state === "object"
        ? (vendorConv.intake_state as Record<string, unknown>)
        : {}
    const prev = readVendorScheduleFsm(vendorIntake)
    const reduced = reduceScheduleFsm(prev, { type: "TENANT_NO", at })
    await persistVendorScheduleFsm(supabase, {
      conversationId: pending.vendorConversationId,
      ticketId: pending.ticketId,
      next: reduced.state,
    })
  }

  if (laterSameDay) {
    const { data: vendor } = await supabase
      .from("vendors")
      .select("name, phone")
      .eq("id", pending.vendorId)
      .maybeSingle()
    const vendorName =
      typeof vendor?.name === "string" && vendor.name.trim()
        ? vendor.name.trim()
        : "the vendor"
    const phone = typeof vendor?.phone === "string" ? vendor.phone.trim() : ""
    const { deliverVendorTextWithRetry } = await import("./vendorRescheduleSms.ts")
    const { sendVendorJobAlert } = await import("./vendorSmsRouting.ts")
    const vendorBody = buildVendorLaterSameDaySms(pending.windowText)
    const delivery = await deliverVendorTextWithRetry(async () => {
      if (!phone) return { ok: false, error: "no_vendor_phone" }
      const alert = await sendVendorJobAlert(supabase, {
        ticketId: pending.ticketId,
        vendorId: pending.vendorId,
        vendorPhone: phone,
        body: vendorBody,
        landlordId: params.landlordId,
      })
      return {
        ok: alert.ok,
        error: alert.ok ? undefined : alert.error || "send_failed",
        conversationId: alert.ok ? alert.conversationId : null,
      }
    })
    if (!delivery.ok) {
      console.error(
        "[tenant-schedule] vendorNotified=false",
        delivery.reason,
        { attempts: delivery.attempts },
      )
      laterSameDayReply =
        "I've passed your request for a later time to the property team. They'll follow up here."
    } else {
      laterSameDayReply = buildTenantLaterSameDayAckSms({
        vendorName,
        dayLabel: dayLabelFromWindow(pending.windowText),
      })
    }
  } else if (pending.vendorConversationId) {
    await notifyVendorOnThread(supabase, {
      conversationId: pending.vendorConversationId,
      ticketId: pending.ticketId,
      vendorId: pending.vendorId,
      body: buildVendorTenantNeedsDifferentTimeSms(preferredWindow),
    })
  }

  if (isReschedule) {
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("unit")
      .eq("id", pending.ticketId)
      .maybeSingle()
    const unitLabel =
      typeof ticket?.unit === "string" && ticket.unit.trim()
        ? `Apt ${ticket.unit.trim()}`
        : "the unit"
    await notifyLandlordOpsSms(
      supabase,
      params.landlordId,
      buildLandlordResidentDeclinedRescheduleSms({
        unitLabel,
        newTimeLabel,
      }),
      {
        messageType: "landlord_resident_declined_reschedule",
        ticketId: pending.ticketId,
      },
    )
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "maintenance.resident_reschedule_declined",
      source: "sms",
      actor_type: "resident",
      vendor_id: pending.vendorId,
      maintenance_request_id: pending.ticketId,
      conversation_id: params.conversationId,
      message_id: params.messageId,
      metadata: {
        window_text: pending.windowText,
        status: confirmationStatus,
        resident_body: params.body.slice(0, 200),
        preferred_window: preferredWindow,
      },
    })
  } else {
    await logGraphEvent(supabase, {
      landlord_id: params.landlordId,
      event_type: "maintenance.schedule_tenant_declined",
      source: "sms",
      actor_type: "resident",
      vendor_id: pending.vendorId,
      maintenance_request_id: pending.ticketId,
      conversation_id: params.conversationId,
      message_id: params.messageId,
      metadata: {
        window_text: pending.windowText,
        preferred_window: preferredWindow,
        status: confirmationStatus,
      },
    })
  }

  return {
    handled: true,
    action: decision,
    ticketId: pending.ticketId,
    replyBody: `${
      laterSameDayReply ?? buildTenantScheduleDeclinedSms(preferredWindow)
    } ${workOrderRef}`.trim(),
  }
}
