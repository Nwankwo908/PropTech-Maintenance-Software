/**
 * Landlord estimate approval notify — thread/state first, delivery second.
 * Pending-estimate state must never depend on a successful SMS send.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { sendLandlordOpsEmail } from "../landlordOpsNotify.ts"
import {
  ensureLandlordMainSmsNumber,
  findActiveLandlordMainNumber,
} from "./landlordSmsOnboarding.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "./inbound_db.ts"
import { getSMSProviderForSend } from "./providerFactory.ts"
import { resolveLandlordOpsPhones } from "./tenantActivationAdminAlert.ts"
import { buildLandlordEstimateApprovalSms } from "./estimateApprovalSms.ts"
import { formatWorkOrderRef } from "../vendor_outreach_copy.ts"

export const LANDLORD_ESTIMATE_NOTIFY_SOURCE = "landlord_estimate_notify"
export const MAX_ESTIMATE_SMS_ATTEMPTS = 3
/** Default stall window for reconciliation (minutes). */
export const DEFAULT_ESTIMATE_NOTIFY_STALL_MINUTES = 20

export type EstimateNotifyChannel = "sms" | "email" | "thread_repair"
export type EstimateNotifyDeliveryStatus =
  | "sent"
  | "failed"
  | "skipped"
  | "no_response"

export type LandlordEstimateNotificationRow = {
  id: string
  estimate_id: string
  landlord_id: string
  ticket_id: string
  conversation_id: string | null
  sms_body: string | null
  notify_status: string
  sms_attempt_count: number
  email_attempt_count: number
  staff_alerted_at?: string | null
  last_sms_error?: string | null
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function respondFnBase(): string {
  const explicit = Deno.env.get("LANDLORD_ESTIMATE_RESPOND_FN_URL")?.trim()?.replace(
    /\/$/,
    "",
  )
  if (explicit) return explicit
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim()?.replace(/\/$/, "") ?? ""
  if (!supabaseUrl) return ""
  return `${supabaseUrl}/functions/v1/landlord-respond-estimate`
}

export function buildEstimateApproveDeclineUrls(params: {
  estimateId: string
  actionToken: string
}): { approveUrl: string | null; rejectUrl: string | null } {
  const base = respondFnBase()
  if (!base) return { approveUrl: null, rejectUrl: null }
  return {
    approveUrl:
      `${base}?action=approve&estimateId=${encodeURIComponent(params.estimateId)}&token=${encodeURIComponent(params.actionToken)}`,
    rejectUrl:
      `${base}?action=reject&estimateId=${encodeURIComponent(params.estimateId)}&token=${encodeURIComponent(params.actionToken)}`,
  }
}

function smsLineFromRow(
  row: { id: string; phone_number: string; provider?: string | null },
): { id: string; phone_number: string; provider: string } {
  return {
    id: row.id,
    phone_number: row.phone_number.trim(),
    provider: String(row.provider ?? "twilio"),
  }
}

/**
 * Resolve outbound SMS line. When none exists, provision/repair via
 * ensureLandlordMainSmsNumber. Logs a visible workflow error only if repair fails.
 */
export async function resolveLandlordEstimateSmsLine(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<{ id: string; phone_number: string; provider: string } | null> {
  const main = await findActiveLandlordMainNumber(supabase, landlordId)
  if (main?.id && main.phone_number?.trim()) {
    return smsLineFromRow(main)
  }

  try {
    const repaired = await ensureLandlordMainSmsNumber(supabase, landlordId)
    if (repaired.number?.id && repaired.number.phone_number?.trim()) {
      console.warn("[estimate-notify] repaired landlord SMS line", {
        landlordId,
        smsNumberId: repaired.number.id,
        source: repaired.source,
      })
      return smsLineFromRow(repaired.number)
    }
  } catch (e) {
    console.error("[estimate-notify] thread repair failed", {
      landlordId,
      error: e instanceof Error ? e.message : String(e),
    })
    await recordActivityLog(supabase, {
      landlordId,
      eventType: "maintenance.estimate_notify_thread_failed",
      source: "automation",
      actorType: "system",
      metadata: {
        message:
          "Could not open or repair a landlord SMS line for an estimate approval ask.",
        error: e instanceof Error ? e.message : String(e),
      },
    }).catch(() => {})
  }

  console.error(
    "[estimate-notify] no usable SMS line for landlord after repair attempt",
    { landlordId },
  )
  return null
}

async function recordNotifyAttempt(
  supabase: SupabaseClient,
  params: {
    notificationId: string
    estimateId: string
    landlordId: string
    channel: EstimateNotifyChannel
    phone?: string | null
    deliveryStatus: EstimateNotifyDeliveryStatus
    failureReason?: string | null
    providerMessageSid?: string | null
    attemptNumber: number
    conversationId?: string | null
  },
): Promise<void> {
  const { error } = await supabase.from("landlord_estimate_notify_attempts").insert({
    notification_id: params.notificationId,
    estimate_id: params.estimateId,
    landlord_id: params.landlordId,
    channel: params.channel,
    phone: params.phone?.trim() || null,
    delivery_status: params.deliveryStatus,
    failure_reason: params.failureReason?.trim() || null,
    provider_message_sid: params.providerMessageSid?.trim() || null,
    attempt_number: params.attemptNumber,
    conversation_id: params.conversationId?.trim() || null,
  })
  if (error) {
    console.error("[estimate-notify] attempt insert", error.message)
  }
}

/**
 * Ensure conversation + awaiting_estimate_decision + notification row exist.
 * Idempotent per estimate_id. Does not send SMS/email.
 */
export async function ensureLandlordEstimateNotifyState(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    estimateId: string
    actionToken: string
    ticketId: string
    smsBody: string
    preferPhone?: string | null
  },
): Promise<
  | { ok: true; notification: LandlordEstimateNotificationRow; conversationId: string }
  | { ok: false; error: string }
> {
  const { data: existing } = await supabase
    .from("landlord_estimate_notifications")
    .select(
      "id, estimate_id, landlord_id, ticket_id, conversation_id, sms_body, notify_status, sms_attempt_count, email_attempt_count",
    )
    .eq("estimate_id", params.estimateId)
    .maybeSingle()

  if (existing?.id) {
    const existingConvId =
      typeof existing.conversation_id === "string" && existing.conversation_id.trim()
        ? existing.conversation_id.trim()
        : ""
    if (existingConvId) {
      await setAwaitingEstimateDecision(supabase, {
        conversationId: existingConvId,
        estimateId: params.estimateId,
        actionToken: params.actionToken,
        ticketId: params.ticketId,
      })
      if (params.smsBody && existing.sms_body !== params.smsBody) {
        await supabase
          .from("landlord_estimate_notifications")
          .update({
            sms_body: params.smsBody,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
      }
      return {
        ok: true,
        notification: existing as LandlordEstimateNotificationRow,
        conversationId: existingConvId,
      }
    }
    // Row exists without a conversation — fall through to repair thread.
  }

  const line = await resolveLandlordEstimateSmsLine(supabase, params.landlordId)
  if (!line) {
    const { data: orphan, error: orphanErr } = await supabase
      .from("landlord_estimate_notifications")
      .upsert(
        {
          estimate_id: params.estimateId,
          landlord_id: params.landlordId,
          ticket_id: params.ticketId,
          conversation_id: null,
          sms_body: params.smsBody,
          notify_status: "awaiting_decision",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "estimate_id" },
      )
      .select(
        "id, estimate_id, landlord_id, ticket_id, conversation_id, sms_body, notify_status, sms_attempt_count, email_attempt_count, staff_alerted_at, last_sms_error",
      )
      .single()
    if (orphan?.id) {
      await recordNotifyAttempt(supabase, {
        notificationId: orphan.id as string,
        estimateId: params.estimateId,
        landlordId: params.landlordId,
        channel: "thread_repair",
        deliveryStatus: "failed",
        failureReason: "no_sms_line",
        attemptNumber: 1,
      })
    }
    await recordActivityLog(supabase, {
      landlordId: params.landlordId,
      eventType: "maintenance.estimate_notify_thread_failed",
      source: "automation",
      actorType: "system",
      maintenanceRequestId: params.ticketId,
      metadata: {
        estimate_id: params.estimateId,
        message:
          "Could not open a landlord SMS thread for an estimate approval ask — no usable property-team line.",
      },
    }).catch(() => {})
    if (orphanErr || !orphan) {
      return { ok: false, error: orphanErr?.message || "no_sms_line" }
    }
    return {
      ok: true,
      notification: orphan as LandlordEstimateNotificationRow,
      conversationId: "",
    }
  }

  const { phones } = await resolveLandlordOpsPhones(supabase, params.landlordId)
  const phone =
    (params.preferPhone?.trim() &&
      phones.includes(params.preferPhone.trim())
      ? params.preferPhone.trim()
      : null) ||
    phones[0] ||
    null
  if (!phone) {
    console.error("[estimate-notify] no ops phone for landlord", {
      landlordId: params.landlordId,
      estimateId: params.estimateId,
    })
    // Still create notification row without conversation so reconciliation can fire.
    const { data: orphan, error: orphanErr } = await supabase
      .from("landlord_estimate_notifications")
      .upsert(
        {
          estimate_id: params.estimateId,
          landlord_id: params.landlordId,
          ticket_id: params.ticketId,
          conversation_id: null,
          sms_body: params.smsBody,
          notify_status: "awaiting_decision",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "estimate_id" },
      )
      .select(
        "id, estimate_id, landlord_id, ticket_id, conversation_id, sms_body, notify_status, sms_attempt_count, email_attempt_count",
      )
      .single()
    if (orphanErr || !orphan) {
      return { ok: false, error: orphanErr?.message || "notify_upsert_failed" }
    }
    await recordNotifyAttempt(supabase, {
      notificationId: orphan.id as string,
      estimateId: params.estimateId,
      landlordId: params.landlordId,
      channel: "thread_repair",
      deliveryStatus: "failed",
      failureReason: "no_ops_phone",
      attemptNumber: 1,
    })
    return {
      ok: true,
      notification: orphan as LandlordEstimateNotificationRow,
      conversationId: "",
    }
  }

  const identity = await upsertSmsIdentityForPhone(supabase, {
    landlordId: params.landlordId,
    phone,
    identityType: "landlord",
  })
  if (!identity) {
    console.error("[estimate-notify] landlord identity upsert failed", {
      landlordId: params.landlordId,
      estimateId: params.estimateId,
    })
    return { ok: false, error: "identity_failed" }
  }

  const { conversationId } = await findOrCreateConversation(supabase, {
    landlordId: params.landlordId,
    smsNumberId: line.id,
    externalPhone: phone,
    identity,
    maintenanceRequestId: params.ticketId,
    conversationStatus: "open",
  })

  await setAwaitingEstimateDecision(supabase, {
    conversationId,
    estimateId: params.estimateId,
    actionToken: params.actionToken,
    ticketId: params.ticketId,
  })

  // Idempotent outbound mirror on the thread (one body per estimate).
  const { data: priorMsg } = await supabase
    .from("sms_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("landlord_id", params.landlordId)
    .filter("raw_payload->>source", "eq", LANDLORD_ESTIMATE_NOTIFY_SOURCE)
    .filter("raw_payload->>estimate_id", "eq", params.estimateId)
    .limit(1)
    .maybeSingle()

  if (!priorMsg?.id) {
    await supabase.from("sms_messages").insert({
      conversation_id: conversationId,
      landlord_id: params.landlordId,
      direction: "outbound",
      from_number: normalizeSmsPhone(line.phone_number),
      to_number: normalizeSmsPhone(phone),
      body: params.smsBody,
      media_urls: [],
      provider: line.provider,
      provider_message_sid: `landlord-estimate-state:${params.estimateId}`,
      provider_status: "queued",
      raw_payload: {
        source: LANDLORD_ESTIMATE_NOTIFY_SOURCE,
        estimate_id: params.estimateId,
        state_only: true,
      },
    })
  }

  const { data: notification, error: upErr } = await supabase
    .from("landlord_estimate_notifications")
    .upsert(
      {
        estimate_id: params.estimateId,
        landlord_id: params.landlordId,
        ticket_id: params.ticketId,
        conversation_id: conversationId,
        sms_body: params.smsBody,
        notify_status: "awaiting_decision",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "estimate_id" },
    )
    .select(
      "id, estimate_id, landlord_id, ticket_id, conversation_id, sms_body, notify_status, sms_attempt_count, email_attempt_count",
    )
    .single()

  if (upErr || !notification) {
    console.error("[estimate-notify] notification upsert", upErr?.message)
    return { ok: false, error: upErr?.message || "notify_upsert_failed" }
  }

  return {
    ok: true,
    notification: notification as LandlordEstimateNotificationRow,
    conversationId,
  }
}

async function setAwaitingEstimateDecision(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    estimateId: string
    actionToken: string
    ticketId: string
  },
): Promise<void> {
  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()
  const prior =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? { ...(conv.intake_state as Record<string, unknown>) }
      : {}
  delete prior.unknown_contact_intake
  await supabase
    .from("sms_conversations")
    .update({
      updated_at: new Date().toISOString(),
      status: "open",
      conversation_type: "landlord_update",
      maintenance_request_id: params.ticketId,
      intake_state: {
        ...prior,
        awaiting_estimate_decision: {
          estimate_id: params.estimateId,
          action_token: params.actionToken,
          ticket_id: params.ticketId,
        },
      },
    })
    .eq("id", params.conversationId)
}

async function deliverEstimateSmsToPhones(
  supabase: SupabaseClient,
  params: {
    notification: LandlordEstimateNotificationRow
    smsBody: string
    phones: string[]
    fromNumber: string | null
    lineProvider: string | null
    conversationId: string | null
  },
): Promise<void> {
  const provider = getSMSProviderForSend({
    landlordId: params.notification.landlord_id,
    lineProvider: params.lineProvider,
  })
  let attemptBase = params.notification.sms_attempt_count || 0

  for (const phone of params.phones) {
    attemptBase += 1
    let deliveryStatus: EstimateNotifyDeliveryStatus = "no_response"
    let failureReason: string | null = null
    let sid: string | null = null
    try {
      const sendResult = await provider.sendMessage({
        to: phone,
        body: params.smsBody,
        from: params.fromNumber ?? undefined,
      })
      if (sendResult.error) {
        deliveryStatus = "failed"
        failureReason = sendResult.error
        console.error("[estimate-notify] landlord SMS", phone, sendResult.error)
      } else {
        deliveryStatus = "sent"
        sid =
          sendResult.providerMessageSid ??
          sendResult.messageId ??
          null
      }
    } catch (e) {
      deliveryStatus = "no_response"
      failureReason = e instanceof Error ? e.message : String(e)
      console.error("[estimate-notify] landlord SMS threw", phone, e)
    }

    await recordNotifyAttempt(supabase, {
      notificationId: params.notification.id,
      estimateId: params.notification.estimate_id,
      landlordId: params.notification.landlord_id,
      channel: "sms",
      phone,
      deliveryStatus,
      failureReason,
      providerMessageSid: sid,
      attemptNumber: attemptBase,
      conversationId: params.conversationId,
    })

    await supabase
      .from("landlord_estimate_notifications")
      .update({
        sms_attempt_count: attemptBase,
        last_sms_attempt_at: new Date().toISOString(),
        last_sms_error: deliveryStatus === "sent" ? null : failureReason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.notification.id)

    if (deliveryStatus === "sent" && sid && params.conversationId) {
      // Best-effort: attach a real carrier SID copy (state-only row already exists).
      await supabase.from("sms_messages").insert({
        conversation_id: params.conversationId,
        landlord_id: params.notification.landlord_id,
        direction: "outbound",
        from_number: normalizeSmsPhone(params.fromNumber ?? ""),
        to_number: normalizeSmsPhone(phone),
        body: params.smsBody,
        media_urls: [],
        provider: params.lineProvider ?? "twilio",
        provider_message_sid: sid,
        provider_status: "sent",
        raw_payload: {
          source: LANDLORD_ESTIMATE_NOTIFY_SOURCE,
          estimate_id: params.notification.estimate_id,
        },
      }).then(({ error }) => {
        if (error) {
          console.warn("[estimate-notify] delivery mirror insert", error.message)
        }
      })
    }
  }
}

async function deliverEstimateEmail(
  supabase: SupabaseClient,
  params: {
    notification: LandlordEstimateNotificationRow
    ticketId: string
    unit: string
    vendorName: string
    vendorEmail?: string | null
    partsCost: number
    laborCost: number
    totalCost: number
    notes: string | null
    approveUrl: string | null
    rejectUrl: string | null
  },
): Promise<void> {
  const wo = formatWorkOrderRef(params.ticketId)
  const attemptNumber = (params.notification.email_attempt_count || 0) + 1
  const subject = `Approve estimate for ${wo}`
  const text = [
    `A vendor submitted an estimate for work order ${wo}.`,
    "",
    `Unit: ${params.unit || "—"}`,
    `Vendor: ${params.vendorName}`,
    `Parts: ${money(params.partsCost)}`,
    `Labor: ${money(params.laborCost)}`,
    `Total: ${money(params.totalCost)}`,
    params.notes ? `Notes: ${params.notes}` : null,
    "",
    params.approveUrl ? `Approve: ${params.approveUrl}` : null,
    params.rejectUrl ? `Decline: ${params.rejectUrl}` : null,
    "",
    "Reply APPROVE or DECLINE by text, or tap a link below — no login required.",
  ]
    .filter(Boolean)
    .join("\n")

  const html = `<p>A vendor submitted an estimate for work order <strong>${wo}</strong>.</p>
<ul>
<li><strong>Unit:</strong> ${params.unit || "—"}</li>
<li><strong>Vendor:</strong> ${params.vendorName}</li>
<li><strong>Parts:</strong> ${money(params.partsCost)}</li>
<li><strong>Labor:</strong> ${money(params.laborCost)}</li>
<li><strong>Total:</strong> ${money(params.totalCost)}</li>
</ul>
${params.notes ? `<p>Notes: ${params.notes}</p>` : ""}
${
    params.approveUrl
      ? `<p><a href="${params.approveUrl}" style="display:inline-block;padding:10px 16px;background:#186179;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Approve estimate</a></p>
<p><a href="${params.rejectUrl ?? "#"}">Decline estimate</a></p>`
      : "<p>Open the admin dashboard to review this estimate.</p>"
  }`

  let deliveryStatus: EstimateNotifyDeliveryStatus = "no_response"
  let failureReason: string | null = null
  try {
    await sendLandlordOpsEmail(supabase, {
      landlordId: params.notification.landlord_id,
      subject,
      text,
      html,
      excludeEmails: params.vendorEmail ? [params.vendorEmail] : [],
      logLabel: `estimate-pending:${params.notification.estimate_id}`,
    })
    deliveryStatus = "sent"
  } catch (e) {
    deliveryStatus = "failed"
    failureReason = e instanceof Error ? e.message : String(e)
    console.error("[estimate-notify] landlord email", e)
  }

  await recordNotifyAttempt(supabase, {
    notificationId: params.notification.id,
    estimateId: params.notification.estimate_id,
    landlordId: params.notification.landlord_id,
    channel: "email",
    deliveryStatus,
    failureReason,
    attemptNumber,
    conversationId: params.notification.conversation_id,
  })

  await supabase
    .from("landlord_estimate_notifications")
    .update({
      email_attempt_count: attemptNumber,
      last_email_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.notification.id)
}

/**
 * Full notify path: (1) resolve/repair thread + pending state, (2) SMS per phone,
 * (3) email — each channel independent. Pending state never waits on delivery.
 */
export async function notifyLandlordEstimatePending(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    estimateId: string
    actionToken: string
    ticketId: string
    unit: string
    vendorId: string
    vendorName: string
    vendorEmail?: string | null
    partsCost: number
    laborCost: number
    totalCost: number
    notes: string | null
    exceedsEscalationThreshold?: boolean
  },
): Promise<{ notificationId: string | null; conversationId: string | null }> {
  const wo = formatWorkOrderRef(params.ticketId)
  const { approveUrl, rejectUrl } = buildEstimateApproveDeclineUrls({
    estimateId: params.estimateId,
    actionToken: params.actionToken,
  })

  const { data: landlord } = await supabase
    .from("landlords")
    .select("name")
    .eq("id", params.landlordId)
    .maybeSingle()
  const landlordFirstName = (() => {
    const raw = typeof landlord?.name === "string" ? landlord.name.trim() : ""
    if (!raw) return null
    return raw.split(/\s+/)[0] ?? null
  })()

  const smsBody = buildLandlordEstimateApprovalSms({
    vendorName: params.vendorName,
    workOrderRef: wo,
    unit: params.unit,
    totalCost: params.totalCost,
    partsCost: params.partsCost,
    laborCost: params.laborCost,
    exceedsEscalationThreshold: params.exceedsEscalationThreshold,
    approveUrl,
    rejectUrl,
    landlordFirstName,
  })

  const ensured = await ensureLandlordEstimateNotifyState(supabase, {
    landlordId: params.landlordId,
    estimateId: params.estimateId,
    actionToken: params.actionToken,
    ticketId: params.ticketId,
    smsBody,
  })

  if (!ensured.ok) {
    // Still attempt email so the landlord gets the link.
    console.error("[estimate-notify] state ensure failed", ensured.error)
  }

  const notification = ensured.ok ? ensured.notification : null
  const conversationId =
    ensured.ok && ensured.conversationId.trim()
      ? ensured.conversationId
      : null

  const line = await resolveLandlordEstimateSmsLine(supabase, params.landlordId)
  const { phones } = await resolveLandlordOpsPhones(supabase, params.landlordId)

  if (notification && phones.length > 0 && line) {
    await deliverEstimateSmsToPhones(supabase, {
      notification,
      smsBody,
      phones,
      fromNumber: line.phone_number,
      lineProvider: line.provider,
      conversationId,
    })
  } else if (notification) {
    await recordNotifyAttempt(supabase, {
      notificationId: notification.id,
      estimateId: params.estimateId,
      landlordId: params.landlordId,
      channel: "sms",
      deliveryStatus: "skipped",
      failureReason: !line
        ? "no_sms_line"
        : phones.length === 0
          ? "no_ops_phone"
          : "skipped",
      attemptNumber: (notification.sms_attempt_count || 0) + 1,
      conversationId,
    })
  }

  if (notification) {
    await deliverEstimateEmail(supabase, {
      notification,
      ticketId: params.ticketId,
      unit: params.unit,
      vendorName: params.vendorName,
      vendorEmail: params.vendorEmail,
      partsCost: params.partsCost,
      laborCost: params.laborCost,
      totalCost: params.totalCost,
      notes: params.notes,
      approveUrl,
      rejectUrl,
    })

    const { data: refreshed } = await supabase
      .from("landlord_estimate_notifications")
      .select("sms_attempt_count, staff_alerted_at, last_sms_error")
      .eq("id", notification.id)
      .maybeSingle()
    const smsAttempts = Number(refreshed?.sms_attempt_count) || 0
    const anySmsSent = await (async () => {
      const { data: sent } = await supabase
        .from("landlord_estimate_notify_attempts")
        .select("id")
        .eq("notification_id", notification.id)
        .eq("channel", "sms")
        .eq("delivery_status", "sent")
        .limit(1)
        .maybeSingle()
      return Boolean(sent?.id)
    })()
    if (
      !anySmsSent &&
      (smsAttempts >= MAX_ESTIMATE_SMS_ATTEMPTS || !line || phones.length === 0) &&
      !refreshed?.staff_alerted_at
    ) {
      await alertStaffEstimateNotifyExhausted(supabase, {
        landlordId: params.landlordId,
        estimateId: params.estimateId,
        ticketId: params.ticketId,
        notificationId: notification.id,
        reason:
          refreshed?.last_sms_error ||
          (!line ? "no_sms_line" : phones.length === 0 ? "no_ops_phone" : "sms_failed"),
      })
    }
  } else {
    // State failed entirely — still try email with ad-hoc send so link exists.
    try {
      await sendLandlordOpsEmail(supabase, {
        landlordId: params.landlordId,
        subject: `Approve estimate for ${wo}`,
        text: smsBody,
        html: `<pre>${smsBody.replace(/</g, "&lt;")}</pre>`,
        excludeEmails: params.vendorEmail ? [params.vendorEmail] : [],
        logLabel: `estimate-pending-fallback:${params.estimateId}`,
      })
    } catch (e) {
      console.error("[estimate-notify] fallback email", e)
    }
  }

  return {
    notificationId: notification?.id ?? null,
    conversationId,
  }
}

export async function markEstimateNotificationDecided(
  supabase: SupabaseClient,
  estimateId: string,
): Promise<void> {
  await supabase
    .from("landlord_estimate_notifications")
    .update({
      notify_status: "decided",
      updated_at: new Date().toISOString(),
    })
    .eq("estimate_id", estimateId)
    .eq("notify_status", "awaiting_decision")
}

/** Staff alert when SMS retries are exhausted. */
export async function alertStaffEstimateNotifyExhausted(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    estimateId: string
    ticketId: string
    notificationId: string
    reason: string
  },
): Promise<void> {
  const { data: row } = await supabase
    .from("landlord_estimate_notifications")
    .select("staff_alerted_at")
    .eq("id", params.notificationId)
    .maybeSingle()
  if (row?.staff_alerted_at) return

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "maintenance.estimate_notify_delivery_failed",
    source: "automation",
    actorType: "system",
    maintenanceRequestId: params.ticketId,
    metadata: {
      estimate_id: params.estimateId,
      notification_id: params.notificationId,
      message:
        `Estimate approval text for ${formatWorkOrderRef(params.ticketId)} could not be delivered after ${MAX_ESTIMATE_SMS_ATTEMPTS} tries (${params.reason}). Email may still have been sent — check the landlord thread.`,
    },
  })

  await supabase
    .from("landlord_estimate_notifications")
    .update({
      staff_alerted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.notificationId)
}

/**
 * Retry failed SMS for awaiting notifications under the attempt cap.
 * Also reconciles estimates submitted with no notification row.
 */
export async function processLandlordEstimateNotifyRetries(
  supabase: SupabaseClient,
  options?: {
    landlordId?: string | null
    stallMinutes?: number
    now?: Date
  },
): Promise<{
  retried: number
  reconciled: number
  staffAlerts: number
}> {
  const now = options?.now ?? new Date()
  const stallMs =
    (options?.stallMinutes ?? DEFAULT_ESTIMATE_NOTIFY_STALL_MINUTES) * 60_000
  let retried = 0
  let reconciled = 0
  let staffAlerts = 0

  let pendingQ = supabase
    .from("landlord_estimate_notifications")
    .select(
      "id, estimate_id, landlord_id, ticket_id, conversation_id, sms_body, notify_status, sms_attempt_count, email_attempt_count, last_sms_attempt_at, last_sms_error, staff_alerted_at",
    )
    .eq("notify_status", "awaiting_decision")
    .lt("sms_attempt_count", MAX_ESTIMATE_SMS_ATTEMPTS)
    .limit(50)
  if (options?.landlordId?.trim()) {
    pendingQ = pendingQ.eq("landlord_id", options.landlordId.trim())
  }
  const { data: pendingRows } = await pendingQ

  for (const row of pendingRows ?? []) {
    const { data: estimate } = await supabase
      .from("maintenance_estimates")
      .select("id, status, landlord_action_token, total_cost, parts_cost, labor_cost, notes")
      .eq("id", row.estimate_id)
      .maybeSingle()
    if (!estimate || estimate.status !== "pending_approval") {
      await markEstimateNotificationDecided(supabase, row.estimate_id as string)
      continue
    }

    const lastAt = row.last_sms_attempt_at
      ? new Date(String(row.last_sms_attempt_at)).getTime()
      : 0
    // Space retries ~15 minutes apart.
    if (lastAt && now.getTime() - lastAt < 15 * 60_000) continue

    const line = await resolveLandlordEstimateSmsLine(
      supabase,
      row.landlord_id as string,
    )
    const { phones } = await resolveLandlordOpsPhones(
      supabase,
      row.landlord_id as string,
    )
    if (!line || phones.length === 0) {
      if (!row.staff_alerted_at) {
        await alertStaffEstimateNotifyExhausted(supabase, {
          landlordId: row.landlord_id as string,
          estimateId: row.estimate_id as string,
          ticketId: row.ticket_id as string,
          notificationId: row.id as string,
          reason: !line ? "no_sms_line" : "no_ops_phone",
        })
        staffAlerts += 1
      }
      continue
    }

    const body =
      typeof row.sms_body === "string" && row.sms_body.trim()
        ? row.sms_body
        : `Ulo: an estimate is waiting for your approval on ${formatWorkOrderRef(String(row.ticket_id))}. Reply APPROVE or DECLINE.`

    await deliverEstimateSmsToPhones(supabase, {
      notification: row as LandlordEstimateNotificationRow,
      smsBody: body,
      phones,
      fromNumber: line.phone_number,
      lineProvider: line.provider,
      conversationId:
        typeof row.conversation_id === "string" ? row.conversation_id : null,
    })
    retried += 1

    const nextCount = (Number(row.sms_attempt_count) || 0) + phones.length
    if (nextCount >= MAX_ESTIMATE_SMS_ATTEMPTS && !row.staff_alerted_at) {
      await alertStaffEstimateNotifyExhausted(supabase, {
        landlordId: row.landlord_id as string,
        estimateId: row.estimate_id as string,
        ticketId: row.ticket_id as string,
        notificationId: row.id as string,
        reason: row.last_sms_error || "sms_retries_exhausted",
      })
      staffAlerts += 1
    }
  }

  // Reconciliation: pending estimates with no notification after stall window.
  const stallBefore = new Date(now.getTime() - stallMs).toISOString()
  let estQ = supabase
    .from("maintenance_estimates")
    .select(
      "id, landlord_id, maintenance_request_id, landlord_action_token, status, submitted_at, parts_cost, labor_cost, total_cost, notes, vendor_id",
    )
    .eq("status", "pending_approval")
    .lt("submitted_at", stallBefore)
    .limit(40)
  if (options?.landlordId?.trim()) {
    estQ = estQ.eq("landlord_id", options.landlordId.trim())
  }
  const { data: stalledEstimates } = await estQ

  for (const est of stalledEstimates ?? []) {
    const { data: existing } = await supabase
      .from("landlord_estimate_notifications")
      .select("id, notify_status")
      .eq("estimate_id", est.id)
      .maybeSingle()
    if (existing?.id) {
      if (existing.notify_status === "awaiting_decision") {
        await supabase
          .from("landlord_estimate_notifications")
          .update({
            notify_status: "stalled",
            reconciled_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq("id", existing.id)
        await recordActivityLog(supabase, {
          landlordId: est.landlord_id as string,
          eventType: "maintenance.estimate_notify_stalled",
          source: "automation",
          actorType: "system",
          maintenanceRequestId: est.maintenance_request_id as string,
          metadata: {
            estimate_id: est.id,
            message:
              `Estimate approval for ${formatWorkOrderRef(String(est.maintenance_request_id))} is still waiting with no landlord decision after the stall window.`,
          },
        })
        staffAlerts += 1
        reconciled += 1
      }
      continue
    }

    // No notify row — recreate state + redeliver.
    const { data: vendor } = await supabase
      .from("vendors")
      .select("name, email")
      .eq("id", est.vendor_id)
      .maybeSingle()
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("unit")
      .eq("id", est.maintenance_request_id)
      .maybeSingle()

    await notifyLandlordEstimatePending(supabase, {
      landlordId: est.landlord_id as string,
      estimateId: est.id as string,
      actionToken: String(est.landlord_action_token),
      ticketId: est.maintenance_request_id as string,
      unit: typeof ticket?.unit === "string" ? ticket.unit : "",
      vendorId: est.vendor_id as string,
      vendorName:
        typeof vendor?.name === "string" && vendor.name.trim()
          ? vendor.name.trim()
          : "Vendor",
      vendorEmail: typeof vendor?.email === "string" ? vendor.email : null,
      partsCost: Number(est.parts_cost) || 0,
      laborCost: Number(est.labor_cost) || 0,
      totalCost: Number(est.total_cost) || 0,
      notes: typeof est.notes === "string" ? est.notes : null,
    })
    reconciled += 1
    staffAlerts += 1
    await recordActivityLog(supabase, {
      landlordId: est.landlord_id as string,
      eventType: "maintenance.estimate_notify_reconciled",
      source: "automation",
      actorType: "system",
      maintenanceRequestId: est.maintenance_request_id as string,
      metadata: {
        estimate_id: est.id,
        message:
          `Re-sent the landlord estimate approval ask for ${formatWorkOrderRef(String(est.maintenance_request_id))} after finding no notify record.`,
      },
    })
  }

  return { retried, reconciled, staffAlerts }
}

export type PendingLandlordEstimate = {
  estimateId: string
  actionToken: string
  ticketId: string
  totalCost: number
  unit: string
  propertyLabel: string
  submittedAt: string | null
  status: string
}

/** Account-level pending estimates for APPROVE when thread state is missing. */
export async function listPendingEstimatesForLandlord(
  supabase: SupabaseClient,
  landlordId: string,
): Promise<PendingLandlordEstimate[]> {
  const { data: rows } = await supabase
    .from("maintenance_estimates")
    .select(
      "id, landlord_action_token, maintenance_request_id, status, submitted_at, total_cost",
    )
    .eq("landlord_id", landlordId)
    .eq("status", "pending_approval")
    .order("submitted_at", { ascending: false })
    .limit(10)

  const out: PendingLandlordEstimate[] = []
  for (const row of rows ?? []) {
    const ticketId = String(row.maintenance_request_id ?? "")
    if (!ticketId || !row.id) continue
    const { data: ticket } = await supabase
      .from("maintenance_requests")
      .select("unit, property_id")
      .eq("id", ticketId)
      .maybeSingle()
    let propertyLabel = ""
    const propertyId =
      typeof ticket?.property_id === "string" ? ticket.property_id : null
    if (propertyId) {
      const { data: prop } = await supabase
        .from("properties")
        .select("address, name")
        .eq("id", propertyId)
        .maybeSingle()
      propertyLabel =
        (typeof prop?.address === "string" && prop.address.trim()) ||
        (typeof prop?.name === "string" && prop.name.trim()) ||
        ""
    }
    out.push({
      estimateId: row.id as string,
      actionToken: String(row.landlord_action_token ?? ""),
      ticketId,
      totalCost: Number(row.total_cost) || 0,
      unit: typeof ticket?.unit === "string" ? ticket.unit : "",
      propertyLabel,
      submittedAt:
        typeof row.submitted_at === "string" ? row.submitted_at : null,
      status: String(row.status ?? "pending_approval"),
    })
  }
  return out
}

export function buildEstimateDisambiguationSms(
  options: PendingLandlordEstimate[],
): string {
  const lines = [
    "Ulo: which estimate should I update?",
    "",
  ]
  options.forEach((opt, i) => {
    const loc = [opt.propertyLabel, opt.unit ? `Unit ${opt.unit}` : null]
      .filter(Boolean)
      .join(" · ")
    const wo = formatWorkOrderRef(opt.ticketId)
    lines.push(
      `${i + 1} — ${loc || wo} · ${money(opt.totalCost)}`,
    )
  })
  lines.push(
    "",
    `Reply ${options.map((_, i) => String(i + 1)).join(", ")} and we'll apply your decision.`,
  )
  return lines.join("\n")
}

export function replyForEstimateTerminalStatus(status: string): string | null {
  switch (status) {
    case "approved":
      return "This estimate was already approved. The vendor was notified."
    case "rejected":
      return "This estimate was already declined. The vendor was notified."
    case "superseded":
      return "That estimate was withdrawn — a newer estimate replaced it. Check your latest approval text or the dashboard."
    case "expired":
      return "That estimate approval ask expired. Open the dashboard or ask the vendor to resubmit."
    case "withdrawn":
      return "That estimate was withdrawn. Open the dashboard if you still need to review costs."
    default:
      return null
  }
}

/**
 * Send disambiguation SMS through the same attempt-logging + retry path as
 * the original estimate notify (uses the newest pending notification row).
 */
export async function sendLandlordEstimateDisambiguationSms(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    options: PendingLandlordEstimate[]
    preferNotificationEstimateId?: string | null
  },
): Promise<{ sent: boolean; body: string }> {
  const body = buildEstimateDisambiguationSms(params.options)
  const preferId = params.preferNotificationEstimateId?.trim() ||
    params.options[0]?.estimateId ||
    ""

  let notification: LandlordEstimateNotificationRow | null = null
  if (preferId) {
    const { data } = await supabase
      .from("landlord_estimate_notifications")
      .select(
        "id, estimate_id, landlord_id, ticket_id, conversation_id, sms_body, notify_status, sms_attempt_count, email_attempt_count, staff_alerted_at, last_sms_error",
      )
      .eq("estimate_id", preferId)
      .maybeSingle()
    notification = (data as LandlordEstimateNotificationRow | null) ?? null
  }

  if (!notification && params.options[0]) {
    try {
      const ensured = await ensureLandlordEstimateNotifyState(supabase, {
        landlordId: params.landlordId,
        estimateId: params.options[0].estimateId,
        actionToken: params.options[0].actionToken,
        ticketId: params.options[0].ticketId,
        smsBody: body,
      })
      if (ensured.ok) notification = ensured.notification
    } catch (e) {
      console.error("[estimate-notify] disambiguation ensure failed", e)
    }
  }

  // Fall back to any awaiting notify row for this landlord.
  if (!notification) {
    const { data: anyRow } = await supabase
      .from("landlord_estimate_notifications")
      .select(
        "id, estimate_id, landlord_id, ticket_id, conversation_id, sms_body, notify_status, sms_attempt_count, email_attempt_count, staff_alerted_at, last_sms_error",
      )
      .eq("landlord_id", params.landlordId)
      .eq("notify_status", "awaiting_decision")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    notification = (anyRow as LandlordEstimateNotificationRow | null) ?? null
  }

  const line = await resolveLandlordEstimateSmsLine(supabase, params.landlordId)
  const { phones } = await resolveLandlordOpsPhones(supabase, params.landlordId)

  // Persist disambiguation ask on the thread before delivery.
  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()
  const prior =
    conv?.intake_state && typeof conv.intake_state === "object"
      ? { ...(conv.intake_state as Record<string, unknown>) }
      : {}
  const priorDisambiguation =
    prior.awaiting_estimate_disambiguation &&
    typeof prior.awaiting_estimate_disambiguation === "object"
      ? (prior.awaiting_estimate_disambiguation as Record<string, unknown>)
      : {}
  await supabase
    .from("sms_conversations")
    .update({
      updated_at: new Date().toISOString(),
      status: "open",
      conversation_type: "landlord_update",
      intake_state: {
        ...prior,
        awaiting_estimate_disambiguation: {
          ...priorDisambiguation,
          options: params.options.map((o) => ({
            estimate_id: o.estimateId,
            action_token: o.actionToken,
            ticket_id: o.ticketId,
          })),
          sms_body: body,
        },
      },
    })
    .eq("id", params.conversationId)

  if (!notification || !line || phones.length === 0) {
    if (notification) {
      await recordNotifyAttempt(supabase, {
        notificationId: notification.id,
        estimateId: notification.estimate_id,
        landlordId: params.landlordId,
        channel: "sms",
        deliveryStatus: "skipped",
        failureReason: !line ? "no_sms_line" : "no_ops_phone",
        attemptNumber: (notification.sms_attempt_count || 0) + 1,
        conversationId: params.conversationId,
      })
      if (!notification.staff_alerted_at) {
        await alertStaffEstimateNotifyExhausted(supabase, {
          landlordId: params.landlordId,
          estimateId: notification.estimate_id,
          ticketId: notification.ticket_id,
          notificationId: notification.id,
          reason: "disambiguation_sms_failed",
        })
      }
    }
    return { sent: false, body }
  }

  const beforeAttempts = notification.sms_attempt_count || 0
  await deliverEstimateSmsToPhones(supabase, {
    notification: { ...notification, sms_body: body },
    smsBody: body,
    phones,
    fromNumber: line.phone_number,
    lineProvider: line.provider,
    conversationId: params.conversationId,
  })

  const { data: recentAttempts } = await supabase
    .from("landlord_estimate_notify_attempts")
    .select("id, delivery_status, attempt_number")
    .eq("notification_id", notification.id)
    .eq("channel", "sms")
    .order("attempt_number", { ascending: false })
    .limit(phones.length)

  const sent = (recentAttempts ?? []).some(
    (row) =>
      row.delivery_status === "sent" &&
      Number(row.attempt_number) > beforeAttempts,
  )

  if (!sent) {
    const nextCount = beforeAttempts + phones.length
    if (nextCount >= MAX_ESTIMATE_SMS_ATTEMPTS) {
      await alertStaffEstimateNotifyExhausted(supabase, {
        landlordId: params.landlordId,
        estimateId: notification.estimate_id,
        ticketId: notification.ticket_id,
        notificationId: notification.id,
        reason: "disambiguation_sms_failed",
      })
    }
  }

  return { sent, body }
}
