import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { logGraphEvent } from "../graph/logGraphEvent.ts"
import { resolveOutboundLandlordSmsLine } from "./landlordSmsOnboarding.ts"
import {
  findOrCreateConversation,
  normalizeSmsPhone,
  upsertSmsIdentityForPhone,
} from "./inbound_db.ts"
import { sendInboundAutoReply } from "./inboundReply.ts"
import {
  composeTenantWelcomeSms,
  updateTenantConsent,
} from "./tenantMessaging.ts"
import {
  notifyLandlordActivationUndeliverable,
  resolveActivationAdminAlerts,
} from "./tenantActivationAdminAlert.ts"
import {
  friendlyActivationFailureReason,
  isPermanentDeliveryFailure,
} from "./tenantActivationFailure.ts"
import {
  isAutomaticRetryDue,
  isRetryableDeliveryFailure,
  MAX_ACTIVATION_ATTEMPTS,
  normalizeActivationPhone,
  type TenantActivationDbStatus,
} from "./tenantActivationRetry.ts"
import type { SmsProviderName } from "./types.ts"

export type SendTenantActivationParams = {
  landlordId: string
  /** Explicit target users.id set (e.g. residents added in this onboarding run). */
  residentIds?: string[]
  /** Landlord/company display name for the welcome copy (not stored on users). */
  companyName?: string | null
  /**
   * Landlord-initiated resend. Restarts the retry sequence (attempt 1 again)
   * even when a prior welcome SMS was sent or action_required was reached.
   */
  resend?: boolean
  /**
   * Cron-driven automatic retry. Only sends when delivery_failed + schedule due.
   * Never resets the attempt sequence.
   */
  automaticRetry?: boolean
}

export type TenantActivationSendResult = {
  residentId: string
  phone: string
  status: "sent" | "skipped" | "failed"
  reason?: string
  conversationId?: string
  messageId?: string
  attemptNumber?: number
  activationStatus?: TenantActivationDbStatus
}

export type SendTenantActivationSummary = {
  landlordId: string
  smsNumberId: string | null
  fromNumber: string | null
  attempted: number
  sent: number
  skipped: number
  failed: number
  results: TenantActivationSendResult[]
}

type ResidentRow = {
  id: string
  full_name: string | null
  phone: string | null
  unit: string | null
  building: string | null
  status: string | null
  sms_consent_status?: string | null
  activation_sms_sent_at?: string | null
  activation_status?: string | null
  activation_attempt_count?: number | null
  first_activation_attempt_at?: string | null
  last_activation_attempt_at?: string | null
  last_delivery_error?: string | null
  activation_phone_normalized?: string | null
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const RESIDENT_SELECT =
  "id, full_name, phone, unit, building, status, sms_consent_status, activation_sms_sent_at, activation_status, activation_attempt_count, first_activation_attempt_at, last_activation_attempt_at, last_delivery_error, activation_phone_normalized"
const RESIDENT_SELECT_CONSENT =
  "id, full_name, phone, unit, building, status, sms_consent_status, activation_sms_sent_at"
const RESIDENT_SELECT_LEGACY = "id, full_name, phone, unit, building, status"

/**
 * Load residents to activate. Prefers an explicit id set; otherwise fans out to
 * every landlord-scoped resident that has a phone. Degrades gracefully when the
 * consent/activation columns are not yet migrated.
 */
async function loadResidents(
  supabase: SupabaseClient,
  params: SendTenantActivationParams,
): Promise<{ rows: ResidentRow[]; activationColumns: boolean; consentColumns: boolean }> {
  const ids = (params.residentIds ?? [])
    .map((id) => id.trim())
    .filter((id) => uuidRe.test(id))

  const runQuery = async (select: string) => {
    let query = supabase
      .from("users")
      .select(select)
      .eq("landlord_id", params.landlordId)
    if (ids.length > 0) {
      query = query.in("id", ids)
    }
    return await query.order("created_at", { ascending: true })
  }

  const full = await runQuery(RESIDENT_SELECT)
  if (!full.error) {
    return {
      rows: (full.data as unknown as ResidentRow[] | null) ?? [],
      activationColumns: true,
      consentColumns: true,
    }
  }

  if (full.error.code === "42703" || /column .* does not exist/i.test(full.error.message)) {
    const consent = await runQuery(RESIDENT_SELECT_CONSENT)
    if (!consent.error) {
      return {
        rows: (consent.data as unknown as ResidentRow[] | null) ?? [],
        activationColumns: false,
        consentColumns: true,
      }
    }
    if (
      consent.error.code === "42703" ||
      /column .* does not exist/i.test(consent.error.message)
    ) {
      const legacy = await runQuery(RESIDENT_SELECT_LEGACY)
      if (legacy.error) throw new Error(legacy.error.message)
      return {
        rows: (legacy.data as unknown as ResidentRow[] | null) ?? [],
        activationColumns: false,
        consentColumns: false,
      }
    }
    throw new Error(consent.error.message)
  }

  throw new Error(full.error.message)
}

async function recordActivationAttempt(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    attemptNumber: number
    phone: string
    deliveryStatus: "sent" | "failed" | "skipped"
    failureReason?: string | null
    messageId?: string | null
    conversationId?: string | null
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("tenant_activation_attempts")
    .insert({
      landlord_id: params.landlordId,
      resident_id: params.residentId,
      attempt_number: params.attemptNumber,
      phone: params.phone || null,
      delivery_status: params.deliveryStatus,
      failure_reason: params.failureReason ?? null,
      message_id: params.messageId ?? null,
      conversation_id: params.conversationId ?? null,
    })
    .select("id")
    .maybeSingle()
  if (error) {
    // Table may not exist yet — never block the send path.
    if (error.code === "42P01" || /does not exist/i.test(error.message)) {
      console.warn("[tenantActivation] attempts table missing — skip audit row")
      return null
    }
    console.warn("[tenantActivation] record attempt failed", error.message)
    return null
  }
  return typeof data?.id === "string" ? data.id : null
}

async function patchActivationState(
  supabase: SupabaseClient,
  residentId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("users").update(patch).eq("id", residentId)
  if (error) {
    if (error.code === "42703" || /column .* does not exist/i.test(error.message)) {
      // Fall back to consent-only columns when retry migration is pending.
      const legacy: Record<string, unknown> = {}
      if ("sms_consent_status" in patch) {
        legacy.sms_consent_status = patch.sms_consent_status
      }
      if ("activation_sms_sent_at" in patch) {
        legacy.activation_sms_sent_at = patch.activation_sms_sent_at
      }
      if (Object.keys(legacy).length === 0) return
      await updateTenantConsent(supabase, residentId, legacy as {
        sms_consent_status: "pending" | "opted_in" | "opted_out"
        activation_sms_sent_at?: string | null
      })
      return
    }
    console.error("[tenantActivation] patchActivationState", error.message)
  }
}

async function notifyLandlordActivationFailed(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    residentId: string
    residentName: string
    phone: string
    unitLabel?: string | null
    propertyName?: string | null
    attemptNumber: number
    attemptId?: string | null
    failureReason?: string | null
    providerErrorCode?: string | null
  },
): Promise<void> {
  await notifyLandlordActivationUndeliverable(supabase, {
    landlordId: params.landlordId,
    residentId: params.residentId,
    residentName: params.residentName,
    phone: params.phone,
    unitLabel: params.unitLabel,
    propertyName: params.propertyName,
    attemptNumber: params.attemptNumber,
    attemptId: params.attemptId,
    failureReason: params.failureReason,
    providerErrorCode: params.providerErrorCode,
  })
}

function skipReasonForResident(
  row: ResidentRow,
  params: SendTenantActivationParams,
): string | null {
  const consent = (row.sms_consent_status ?? "").trim().toLowerCase()
  const activation = (row.activation_status ?? "").trim().toLowerCase()

  if (consent === "opted_out" || activation === "opted_out") {
    return "opted_out"
  }
  if (consent === "opted_in" || activation === "activated") {
    return "opted_in"
  }

  const phone = row.phone?.trim() ?? ""
  if (!phone) return "missing_phone"

  if (params.automaticRetry) {
    if (activation !== "delivery_failed") return "not_eligible"
    const attempts = Math.max(0, Math.floor(Number(row.activation_attempt_count) || 0))
    if (attempts >= MAX_ACTIVATION_ATTEMPTS || activation === "action_required") {
      return "max_attempts"
    }
    const storedPhone = normalizeActivationPhone(row.activation_phone_normalized)
    const currentPhone = normalizeActivationPhone(phone)
    if (storedPhone && currentPhone && storedPhone !== currentPhone) {
      return "phone_changed"
    }
    if (
      !isAutomaticRetryDue({
        activationStatus: activation,
        attemptCount: attempts,
        firstAttemptAt: row.first_activation_attempt_at,
      })
    ) {
      return "not_eligible"
    }
    if (!isRetryableDeliveryFailure(row.last_delivery_error)) {
      return "not_eligible"
    }
    return null
  }

  if (params.resend) return null

  // Initial / post-add send: skip if welcome already delivered and waiting.
  if (row.activation_sms_sent_at || activation === "waiting") {
    return "already_waiting"
  }
  if (activation === "action_required") {
    return "max_attempts"
  }
  if (activation === "delivery_failed") {
    // Let cron own automatic retries; don't re-fire on every add/edit.
    return "already_activated"
  }

  return null
}

/**
 * Send the post-onboarding activation/welcome SMS to pending residents.
 * Records each attempt, updates landlord-facing activation_status, and
 * stops after 3 delivery failures (action_required + landlord notify).
 */
export async function sendTenantActivation(
  supabase: SupabaseClient,
  params: SendTenantActivationParams,
): Promise<SendTenantActivationSummary> {
  const landlordId = params.landlordId.trim()
  if (!uuidRe.test(landlordId)) {
    throw new Error("landlordId is required (uuid)")
  }

  const line = await resolveOutboundLandlordSmsLine(supabase, landlordId)
  const { rows, activationColumns, consentColumns } = await loadResidents(
    supabase,
    params,
  )

  const summary: SendTenantActivationSummary = {
    landlordId,
    smsNumberId: line?.id ?? null,
    fromNumber: line?.phone ?? null,
    attempted: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    results: [],
  }

  if (!line) {
    for (const row of rows) {
      summary.skipped += 1
      summary.results.push({
        residentId: row.id,
        phone: row.phone ?? "",
        status: "skipped",
        reason: "no_active_landlord_sms_line",
      })
    }
    console.warn("[tenantActivation] no active landlord_main SMS line", {
      landlordId,
      residents: rows.length,
    })
    await logGraphEvent(supabase, {
      landlord_id: landlordId,
      event_type: "tenant.activation_sms_failed",
      source: "edge_function",
      actor_type: "system",
      metadata: {
        message:
          "Welcome text could not be sent: no active SMS line is set up for this account.",
        reason: "no_active_landlord_sms_line",
        residents: rows.length,
      },
    })
    return summary
  }

  const provider: SmsProviderName = line.provider === "telnyx"
    ? "telnyx"
    : "twilio"
  const nowIso = new Date().toISOString()

  for (const row of rows) {
    const phone = row.phone?.trim() ?? ""
    const skip = skipReasonForResident(row, params)
    if (skip) {
      summary.skipped += 1
      summary.results.push({
        residentId: row.id,
        phone,
        status: "skipped",
        reason: skip,
        activationStatus: (row.activation_status as TenantActivationDbStatus) ||
          undefined,
      })
      continue
    }

    // Manual resend restarts the sequence before counting this attempt as #1.
    let priorAttempts = Math.max(
      0,
      Math.floor(Number(row.activation_attempt_count) || 0),
    )
    let firstAttemptAt = row.first_activation_attempt_at ?? null
    if (params.resend && activationColumns) {
      priorAttempts = 0
      firstAttemptAt = null
      await patchActivationState(supabase, row.id, {
        activation_attempt_count: 0,
        first_activation_attempt_at: null,
        last_delivery_error: null,
        activation_status: "not_started",
      })
    }

    const attemptNumber = priorAttempts + 1
    summary.attempted += 1

    try {
      const identity = await upsertSmsIdentityForPhone(supabase, {
        landlordId,
        phone,
        identityType: "resident",
        residentId: row.id,
      })

      if (!identity) {
        await finalizeFailedAttempt(supabase, {
          landlordId,
          row,
          phone,
          attemptNumber,
          firstAttemptAt,
          nowIso,
          activationColumns,
          consentColumns,
          reason: "invalid_phone",
          conversationId: null,
          messageId: null,
          provider,
          lineId: line.id,
          fromNumber: line.phone,
          summary,
        })
        continue
      }

      const { conversationId } = await findOrCreateConversation(supabase, {
        landlordId,
        smsNumberId: line.id,
        externalPhone: phone,
        identity,
        conversationStatus: "open",
      })

      const body = composeTenantWelcomeSms({
        tenantName: row.full_name,
        companyName: params.companyName,
      })

      const sent = await sendInboundAutoReply(supabase, {
        conversationId,
        landlordId,
        fromNumber: line.phone,
        toNumber: phone,
        body,
        provider,
        source: params.automaticRetry
          ? "tenant_activation_retry"
          : params.resend
          ? "tenant_activation_resend"
          : "tenant_activation_welcome",
      })

      if (!sent.ok) {
        await finalizeFailedAttempt(supabase, {
          landlordId,
          row,
          phone,
          attemptNumber,
          firstAttemptAt,
          nowIso,
          activationColumns,
          consentColumns,
          reason: sent.error || "provider_error",
          conversationId,
          messageId: sent.messageId ?? null,
          provider,
          lineId: line.id,
          fromNumber: line.phone,
          summary,
        })
        continue
      }

      const phoneNorm = normalizeActivationPhone(phone)
      if (activationColumns) {
        await patchActivationState(supabase, row.id, {
          sms_consent_status: "pending",
          activation_sms_sent_at: nowIso,
          activation_status: "waiting",
          activation_attempt_count: attemptNumber,
          first_activation_attempt_at: firstAttemptAt ?? nowIso,
          last_activation_attempt_at: nowIso,
          last_delivery_error: null,
          activation_phone_normalized: phoneNorm || null,
        })
      } else if (consentColumns) {
        await updateTenantConsent(supabase, row.id, {
          sms_consent_status: "pending",
          activation_sms_sent_at: nowIso,
        })
      }

      await recordActivationAttempt(supabase, {
        landlordId,
        residentId: row.id,
        attemptNumber,
        phone,
        deliveryStatus: "sent",
        messageId: sent.messageId,
        conversationId,
      })

      await logGraphEvent(supabase, {
        landlord_id: landlordId,
        event_type: params.automaticRetry
          ? "tenant.activation_sms_retry_sent"
          : "tenant.activation_sms_sent",
        source: "edge_function",
        actor_type: "system",
        resident_id: row.id,
        conversation_id: conversationId,
        message_id: sent.messageId,
        metadata: {
          message: `Welcome text sent to ${
            row.full_name?.trim() || "resident"
          }. Awaiting YES to confirm SMS updates.`,
          phone: normalizeSmsPhone(phone),
          sms_number_id: line.id,
          from_number: line.phone,
          provider,
          consent_status: "pending",
          attempt_number: attemptNumber,
          activation_status: "waiting",
        },
      })

      if (params.resend) {
        try {
          await resolveActivationAdminAlerts(supabase, {
            landlordId,
            residentId: row.id,
            reason: "resend_succeeded",
          })
        } catch (e) {
          console.warn("[tenantActivation] resolve admin alerts", e)
        }
      }

      summary.sent += 1
      summary.results.push({
        residentId: row.id,
        phone,
        status: "sent",
        conversationId,
        messageId: sent.messageId,
        attemptNumber,
        activationStatus: "waiting",
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error("[tenantActivation] send failed", {
        residentId: row.id,
        message,
      })
      await finalizeFailedAttempt(supabase, {
        landlordId,
        row,
        phone,
        attemptNumber,
        firstAttemptAt,
        nowIso,
        activationColumns,
        consentColumns,
        reason: message,
        conversationId: null,
        messageId: null,
        provider,
        lineId: line.id,
        fromNumber: line.phone,
        summary,
      })
    }
  }

  console.info("[tenantActivation] activation run complete", {
    landlordId,
    attempted: summary.attempted,
    sent: summary.sent,
    skipped: summary.skipped,
    failed: summary.failed,
    automaticRetry: params.automaticRetry === true,
    resend: params.resend === true,
  })

  return summary
}

async function finalizeFailedAttempt(
  supabase: SupabaseClient,
  ctx: {
    landlordId: string
    row: ResidentRow
    phone: string
    attemptNumber: number
    firstAttemptAt: string | null
    nowIso: string
    activationColumns: boolean
    consentColumns: boolean
    reason: string
    conversationId: string | null
    messageId: string | null
    provider: SmsProviderName
    lineId: string
    fromNumber: string
    summary: SendTenantActivationSummary
  },
): Promise<void> {
  const permanent = isPermanentDeliveryFailure(ctx.reason)
  const actionRequired =
    permanent || ctx.attemptNumber >= MAX_ACTIVATION_ATTEMPTS
  const nextStatus: TenantActivationDbStatus = actionRequired
    ? "action_required"
    : "delivery_failed"
  const phoneNorm = normalizeActivationPhone(ctx.phone)
  const friendlyReason = friendlyActivationFailureReason(ctx.reason)

  if (ctx.activationColumns) {
    await patchActivationState(supabase, ctx.row.id, {
      activation_status: nextStatus,
      activation_attempt_count: ctx.attemptNumber,
      first_activation_attempt_at: ctx.firstAttemptAt ?? ctx.nowIso,
      last_activation_attempt_at: ctx.nowIso,
      last_delivery_error: ctx.reason.slice(0, 500),
      activation_phone_normalized: phoneNorm || null,
    })
  }

  const attemptId = await recordActivationAttempt(supabase, {
    landlordId: ctx.landlordId,
    residentId: ctx.row.id,
    attemptNumber: ctx.attemptNumber,
    phone: ctx.phone,
    deliveryStatus: "failed",
    failureReason: ctx.reason,
    messageId: ctx.messageId,
    conversationId: ctx.conversationId,
  })

  await logGraphEvent(supabase, {
    landlord_id: ctx.landlordId,
    event_type: "tenant.activation_delivery_failed",
    source: "edge_function",
    actor_type: "system",
    resident_id: ctx.row.id,
    conversation_id: ctx.conversationId,
    message_id: ctx.messageId,
    metadata: {
      message: `Welcome text to ${
        ctx.row.full_name?.trim() || "resident"
      } could not be delivered.`,
      reason: ctx.reason,
      friendly_reason: friendlyReason,
      phone_last4: phoneNorm ? phoneNorm.slice(-4) : null,
      sms_number_id: ctx.lineId,
      from_number: ctx.fromNumber,
      provider: ctx.provider,
      attempt_number: ctx.attemptNumber,
      activation_status: nextStatus,
      permanent,
    },
  })

  // Keep legacy event for existing feed consumers.
  await logGraphEvent(supabase, {
    landlord_id: ctx.landlordId,
    event_type: "tenant.activation_sms_failed",
    source: "edge_function",
    actor_type: "system",
    resident_id: ctx.row.id,
    conversation_id: ctx.conversationId,
    message_id: ctx.messageId,
    metadata: {
      message: `Welcome text to ${
        ctx.row.full_name?.trim() || "resident"
      } could not be delivered.`,
      reason: ctx.reason,
      friendly_reason: friendlyReason,
      phone_last4: phoneNorm ? phoneNorm.slice(-4) : null,
      attempt_number: ctx.attemptNumber,
      activation_status: nextStatus,
    },
  })

  if (actionRequired) {
    await notifyLandlordActivationFailed(supabase, {
      landlordId: ctx.landlordId,
      residentId: ctx.row.id,
      residentName: ctx.row.full_name?.trim() || "resident",
      phone: ctx.phone,
      unitLabel: ctx.row.unit,
      propertyName: ctx.row.building,
      attemptNumber: ctx.attemptNumber,
      attemptId,
      failureReason: ctx.reason,
    })
  }

  ctx.summary.failed += 1
  ctx.summary.results.push({
    residentId: ctx.row.id,
    phone: ctx.phone,
    status: "failed",
    reason: ctx.reason,
    conversationId: ctx.conversationId ?? undefined,
    messageId: ctx.messageId ?? undefined,
    attemptNumber: ctx.attemptNumber,
    activationStatus: nextStatus,
  })
}

/**
 * Cron: find delivery_failed residents due for retry 2 (T+24h) or 3 (T+72h).
 */
export async function processTenantActivationRetries(
  supabase: SupabaseClient,
  landlordId?: string | null,
): Promise<{
  scanned: number
  due: number
  sent: number
  failed: number
  skipped: number
}> {
  let query = supabase
    .from("users")
    .select(
      "id, landlord_id, full_name, phone, activation_status, activation_attempt_count, first_activation_attempt_at, last_delivery_error, activation_phone_normalized, sms_consent_status",
    )
    .eq("activation_status", "delivery_failed")
    .lt("activation_attempt_count", MAX_ACTIVATION_ATTEMPTS)
    .gt("activation_attempt_count", 0)

  if (landlordId?.trim()) {
    query = query.eq("landlord_id", landlordId.trim())
  }

  const { data, error } = await query.limit(500)
  if (error) {
    if (error.code === "42703" || /column .* does not exist/i.test(error.message)) {
      console.warn("[tenantActivationRetries] columns not migrated yet")
      return { scanned: 0, due: 0, sent: 0, failed: 0, skipped: 0 }
    }
    throw new Error(error.message)
  }

  const rows = (data ?? []) as Array<{
    id: string
    landlord_id: string
    full_name: string | null
    phone: string | null
    activation_status: string | null
    activation_attempt_count: number | null
    first_activation_attempt_at: string | null
    last_delivery_error: string | null
    activation_phone_normalized: string | null
    sms_consent_status: string | null
  }>

  const dueIdsByLandlord = new Map<string, string[]>()
  for (const row of rows) {
    if ((row.sms_consent_status ?? "").toLowerCase() === "opted_in") continue
    if ((row.sms_consent_status ?? "").toLowerCase() === "opted_out") continue
    if (
      !isAutomaticRetryDue({
        activationStatus: row.activation_status,
        attemptCount: Number(row.activation_attempt_count) || 0,
        firstAttemptAt: row.first_activation_attempt_at,
      })
    ) {
      continue
    }
    const stored = normalizeActivationPhone(row.activation_phone_normalized)
    const current = normalizeActivationPhone(row.phone)
    if (stored && current && stored !== current) continue
    if (!isRetryableDeliveryFailure(row.last_delivery_error)) continue

    const lid = row.landlord_id
    const list = dueIdsByLandlord.get(lid) ?? []
    list.push(row.id)
    dueIdsByLandlord.set(lid, list)
  }

  let sent = 0
  let failed = 0
  let skipped = 0
  let due = 0

  for (const [lid, ids] of dueIdsByLandlord) {
    due += ids.length
    // Load company name once per landlord.
    const { data: landlord } = await supabase
      .from("landlords")
      .select("name")
      .eq("id", lid)
      .maybeSingle()
    const companyName =
      typeof landlord?.name === "string" ? landlord.name.trim() || null : null

    const summary = await sendTenantActivation(supabase, {
      landlordId: lid,
      residentIds: ids,
      companyName,
      automaticRetry: true,
    })
    sent += summary.sent
    failed += summary.failed
    skipped += summary.skipped
  }

  return {
    scanned: rows.length,
    due,
    sent,
    failed,
    skipped,
  }
}

/**
 * Async carrier undeliverable for a welcome SMS that was previously accepted.
 * Updates activation state and alerts the landlord when the failure is final.
 */
export async function handleActivationSmsDeliveryFailure(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    messageId: string
    conversationId?: string | null
    residentId?: string | null
    providerStatus: string
    errorCode?: string | null
  },
): Promise<{ handled: boolean; reason?: string; actionRequired?: boolean }> {
  const landlordId = params.landlordId.trim()
  const messageId = params.messageId.trim()
  if (!landlordId || !messageId) {
    return { handled: false, reason: "missing_ids" }
  }

  // Prefer attempt row linked to this message.
  const { data: attemptRow } = await supabase
    .from("tenant_activation_attempts")
    .select("id, resident_id, attempt_number, phone, delivery_status")
    .eq("landlord_id", landlordId)
    .eq("message_id", messageId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  let residentId =
    (typeof attemptRow?.resident_id === "string" ? attemptRow.resident_id : null) ||
    params.residentId?.trim() ||
    null

  if (!residentId && params.conversationId) {
    const { data: conv } = await supabase
      .from("sms_conversations")
      .select("resident_id")
      .eq("id", params.conversationId)
      .maybeSingle()
    if (typeof conv?.resident_id === "string") residentId = conv.resident_id
  }

  if (!residentId) {
    return { handled: false, reason: "not_activation_message" }
  }

  const { data: resident } = await supabase
    .from("users")
    .select(
      "id, full_name, phone, unit, building, sms_consent_status, activation_status, activation_attempt_count, first_activation_attempt_at, last_delivery_error, activation_phone_normalized",
    )
    .eq("id", residentId)
    .eq("landlord_id", landlordId)
    .maybeSingle()

  if (!resident) return { handled: false, reason: "resident_not_found" }

  const consent = String(resident.sms_consent_status ?? "").toLowerCase()
  const activation = String(resident.activation_status ?? "").toLowerCase()
  if (consent === "opted_out" || activation === "opted_out") {
    return { handled: false, reason: "opted_out" }
  }
  if (consent === "opted_in" || activation === "activated") {
    return { handled: false, reason: "already_activated" }
  }

  const failureReason =
    params.errorCode?.trim() ||
    params.providerStatus.trim() ||
    "undelivered"
  const permanent = isPermanentDeliveryFailure(failureReason, params.errorCode)
  const priorAttempts = Math.max(
    0,
    Math.floor(Number(resident.activation_attempt_count) || 0),
  )
  const attemptNumber = Math.max(
    priorAttempts,
    Math.floor(Number(attemptRow?.attempt_number) || 0),
    1,
  )
  // Permanent / non-retryable number issues escalate immediately; temporary stay on retry path.
  const escalateNow =
    permanent ||
    !isRetryableDeliveryFailure(failureReason) ||
    attemptNumber >= MAX_ACTIVATION_ATTEMPTS ||
    activation === "action_required"
  const nextStatus: TenantActivationDbStatus = escalateNow
    ? "action_required"
    : "delivery_failed"
  const nowIso = new Date().toISOString()
  const friendlyReason = friendlyActivationFailureReason(
    failureReason,
    params.errorCode,
  )

  await patchActivationState(supabase, residentId, {
    activation_status: nextStatus,
    activation_attempt_count: attemptNumber,
    last_activation_attempt_at: nowIso,
    last_delivery_error: failureReason.slice(0, 500),
  })

  if (attemptRow?.id && attemptRow.delivery_status !== "failed") {
    await supabase
      .from("tenant_activation_attempts")
      .update({
        delivery_status: "failed",
        failure_reason: failureReason.slice(0, 500),
      })
      .eq("id", attemptRow.id)
  }

  await logGraphEvent(supabase, {
    landlord_id: landlordId,
    event_type: "tenant.activation_delivery_failed",
    source: "sms",
    actor_type: "system",
    resident_id: residentId,
    conversation_id: params.conversationId ?? null,
    message_id: messageId,
    metadata: {
      message: `Welcome text to ${
        resident.full_name?.trim() || "resident"
      } could not be delivered.`,
      reason: failureReason,
      friendly_reason: friendlyReason,
      provider_error_code: params.errorCode ?? null,
      provider_status: params.providerStatus,
      attempt_number: attemptNumber,
      activation_status: nextStatus,
      permanent,
      async_webhook: true,
    },
  })

  if (escalateNow) {
    await notifyLandlordActivationFailed(supabase, {
      landlordId,
      residentId,
      residentName: resident.full_name?.trim() || "resident",
      phone: resident.phone ?? "",
      unitLabel: resident.unit,
      propertyName: resident.building,
      attemptNumber,
      attemptId: typeof attemptRow?.id === "string" ? attemptRow.id : null,
      failureReason,
      providerErrorCode: params.errorCode,
    })
  }

  return { handled: true, actionRequired: escalateNow, reason: nextStatus }
}
