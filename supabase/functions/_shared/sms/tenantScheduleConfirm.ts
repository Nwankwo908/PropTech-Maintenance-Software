/**
 * Ask the resident to approve a vendor-proposed appointment window before
 * locking the schedule and sending the vendor job-detail link.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { normalizePhoneFlexible } from "../resident_notify.ts"
import { formatWorkOrderRef } from "../vendor_outreach_copy.ts"
import { confirmVendorSchedule } from "../vendor_job_schedule.ts"
import {
  appendOutboundContext,
  persistVendorScheduleFsm,
  readVendorScheduleFsm,
  reduceScheduleFsm,
} from "../vendor_schedule_fsm.ts"
import { sendInboundAutoReply } from "./inboundReply.ts"
import {
  findOrCreateConversation,
  upsertSmsIdentityForPhone,
} from "./inbound_db.ts"
import { findActiveLandlordMain } from "./smsNumberPool.ts"
import type { SmsProviderName } from "./types.ts"
import {
  buildLandlordResidentDeclinedRescheduleSms,
  buildVendorResidentConfirmedRescheduleSms,
  formatRescheduleTimeLabel,
} from "./vendorRescheduleSms.ts"
import { findActiveLandlordMainNumber } from "./landlordSmsOnboarding.ts"
import { getSMSProvider } from "./providerFactory.ts"

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
}): string {
  const who = firstName(input.residentName)
  const vendor = input.vendorName.trim() || "the vendor"
  const when = input.windowText.trim() || "the time they shared"
  return [
    `Hi ${who},`,
    "",
    "This is the property management team.",
    "",
    `${vendor} proposed an arrival window of ${when}. Does that work for you?`,
    "",
    "Reply YES to confirm or NO if you need a different time.",
  ].join("\n")
}

export function buildTenantScheduleAcceptedSms(windowText: string): string {
  const when = windowText.trim() || "the window you confirmed"
  return `Thanks — you're confirmed for ${when}. We'll keep you updated on the repair.`
}

export function buildTenantScheduleDeclinedSms(): string {
  return "No problem — we'll ask the vendor for another time and text you again."
}

export function buildVendorWaitingOnTenantSms(windowText: string): string {
  const when = windowText.trim() || "that time"
  return `Thanks — checking with the resident on ${when}. We'll text you once they confirm.`
}

export function buildVendorTenantNeedsDifferentTimeSms(): string {
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

  if (
    normalized === "NO" ||
    normalized === "N" ||
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
  ) {
    // Counter-propose when they offer another day/time with the decline.
    if (
      /\b(tomorrow|today|mon|tue|wed|thu|fri|sat|sun|\d{1,2}\s*(a\.?m\.?|p\.?m\.?))\b/i
        .test(trimmed)
    ) {
      return "counter_propose"
    }
    return "decline"
  }

  if (
    /\b(can they come|come tomorrow|another (?:day|time)|different (?:day|time))\b/i
      .test(trimmed)
  ) {
    return "counter_propose"
  }

  return null
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
): Promise<void> {
  const next = { ...priorIntake }
  delete next[AWAITING_SCHEDULE_CONFIRM_KEY]
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
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

  const smsNumber = await findActiveLandlordMain(supabase, landlordId)
  if (!smsNumber?.phone_number) {
    return { ok: false, conversationId: null, error: "no_landlord_main" }
  }

  const provider = (smsNumber.provider === "telnyx" ? "telnyx" : "twilio") as SmsProviderName
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

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId,
    smsNumberId: smsNumber.id,
    externalPhone: phoneE164,
    identity,
    maintenanceRequestId: params.ticketId,
    conversationStatus: "open",
  })

  const body = buildTenantScheduleAskSms({
    residentName: String(ticket.resident_name ?? ""),
    vendorName,
    windowText: params.windowText,
  })

  const sent = await sendInboundAutoReply(supabase, {
    conversationId,
    landlordId,
    fromNumber: smsNumber.phone_number,
    toNumber: phoneE164,
    body,
    provider,
    source: "tenant_schedule_ask",
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
        },
      },
    })
    .eq("id", conversationId)

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

  const smsNumber = await findActiveLandlordMain(supabase, landlordId)
  if (!smsNumber?.phone_number) return

  const provider = (smsNumber.provider === "telnyx" ? "telnyx" : "twilio") as SmsProviderName
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
): Promise<void> {
  const phones = (Deno.env.get("SMS_ADMIN_NOTIFY_PHONES") ?? "")
    .split(/[,;\s]+/)
    .map((p) => normalizePhoneFlexible(p))
    .filter((p): p is string => Boolean(p))
  if (phones.length === 0) return
  const sender = await findActiveLandlordMainNumber(supabase, landlordId)
  const from = sender?.phone_number?.trim()
  if (!from) return
  const provider = getSMSProvider()
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
  | { handled: false }
> {
  if (params.identityType !== "resident") return { handled: false }

  const decision = parseTenantScheduleDecision(params.body)
  if (!decision) return { handled: false }

  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("id, intake_state, maintenance_request_id")
    .eq("id", params.conversationId)
    .maybeSingle()
  if (!conv) return { handled: false }

  const prior =
    conv.intake_state && typeof conv.intake_state === "object"
      ? (conv.intake_state as Record<string, unknown>)
      : {}
  const pending = readAwaitingScheduleConfirmation(prior)
  if (!pending) return { handled: false }

  await clearAwaitingScheduleConfirmation(supabase, params.conversationId, prior)

  const at = new Date().toISOString()
  const isReschedule = pending.kind === "reschedule"
  const workOrderRef = formatWorkOrderRef(pending.ticketId)
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
      replyBody: buildTenantScheduleAcceptedSms(pending.windowText),
    }
  }

  // decline or counter-propose
  const confirmationStatus =
    decision === "counter_propose" ? "counter_proposed" : "declined"

  if (isReschedule) {
    await supabase
      .from("maintenance_requests")
      .update({
        resident_confirmation_status: confirmationStatus,
        schedule_status: "resident_declined_reschedule",
        schedule_confirmed_at: null,
      })
      .eq("id", pending.ticketId)
  }

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
    await notifyVendorOnThread(supabase, {
      conversationId: pending.vendorConversationId,
      ticketId: pending.ticketId,
      vendorId: pending.vendorId,
      body: buildVendorTenantNeedsDifferentTimeSms(),
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
      metadata: { window_text: pending.windowText },
    })
  }

  return {
    handled: true,
    action: decision,
    ticketId: pending.ticketId,
    replyBody: buildTenantScheduleDeclinedSms(),
  }
}
