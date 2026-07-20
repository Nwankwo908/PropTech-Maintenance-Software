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
import type { SmsProviderName } from "./types.ts"

export type SendTenantActivationParams = {
  landlordId: string
  /** Explicit target users.id set (e.g. residents added in this onboarding run). */
  residentIds?: string[]
  /** Landlord/company display name for the welcome copy (not stored on users). */
  companyName?: string | null
  /** Re-send even when activation_sms_sent_at is already set. */
  resend?: boolean
}

export type TenantActivationSendResult = {
  residentId: string
  phone: string
  status: "sent" | "skipped" | "failed"
  reason?: string
  conversationId?: string
  messageId?: string
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
}

const uuidRe =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const RESIDENT_SELECT =
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
): Promise<{ rows: ResidentRow[]; consentColumns: boolean }> {
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

  const { data, error } = await runQuery(RESIDENT_SELECT)
  if (!error) {
    return {
      rows: (data as unknown as ResidentRow[] | null) ?? [],
      consentColumns: true,
    }
  }

  if (error.code === "42703" || /column .* does not exist/i.test(error.message)) {
    const legacy = await runQuery(RESIDENT_SELECT_LEGACY)
    if (legacy.error) {
      throw new Error(legacy.error.message)
    }
    return {
      rows: (legacy.data as unknown as ResidentRow[] | null) ?? [],
      consentColumns: false,
    }
  }

  throw new Error(error.message)
}

/**
 * Send the post-onboarding activation/welcome SMS to pending residents.
 * Routes through the shared landlord_main line + sms_conversations, stamps
 * consent state, and logs a `tenant.activation_sms_sent` graph event per send.
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
  const { rows, consentColumns } = await loadResidents(supabase, params)

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
    // Surface the misconfiguration in the activity feed instead of failing silently.
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
    if (!phone) {
      summary.skipped += 1
      summary.results.push({
        residentId: row.id,
        phone: "",
        status: "skipped",
        reason: "missing_phone",
      })
      continue
    }

    if (consentColumns && row.sms_consent_status === "opted_out") {
      summary.skipped += 1
      summary.results.push({
        residentId: row.id,
        phone,
        status: "skipped",
        reason: "opted_out",
      })
      continue
    }

    if (consentColumns && row.activation_sms_sent_at && !params.resend) {
      summary.skipped += 1
      summary.results.push({
        residentId: row.id,
        phone,
        status: "skipped",
        reason: "already_activated",
      })
      continue
    }

    summary.attempted += 1

    try {
      const identity = await upsertSmsIdentityForPhone(supabase, {
        landlordId,
        phone,
        identityType: "resident",
        residentId: row.id,
      })

      if (!identity) {
        summary.failed += 1
        summary.results.push({
          residentId: row.id,
          phone,
          status: "failed",
          reason: "invalid_phone",
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
        source: "tenant_activation_welcome",
      })

      if (!sent.ok) {
        summary.failed += 1
        summary.results.push({
          residentId: row.id,
          phone,
          status: "failed",
          reason: sent.error,
          conversationId,
          messageId: sent.messageId,
        })
        await logGraphEvent(supabase, {
          landlord_id: landlordId,
          event_type: "tenant.activation_sms_failed",
          source: "edge_function",
          actor_type: "system",
          resident_id: row.id,
          conversation_id: conversationId,
          message_id: sent.messageId,
          metadata: {
            message: `Welcome text to ${
              row.full_name?.trim() || "resident"
            } could not be delivered.`,
            reason: sent.error,
            phone: normalizeSmsPhone(phone),
            sms_number_id: line.id,
            from_number: line.phone,
            provider,
          },
        })
        continue
      }

      await updateTenantConsent(supabase, row.id, {
        sms_consent_status: "pending",
        activation_sms_sent_at: nowIso,
      })

      await logGraphEvent(supabase, {
        landlord_id: landlordId,
        event_type: "tenant.activation_sms_sent",
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
        },
      })

      summary.sent += 1
      summary.results.push({
        residentId: row.id,
        phone,
        status: "sent",
        conversationId,
        messageId: sent.messageId,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error("[tenantActivation] send failed", { residentId: row.id, message })
      summary.failed += 1
      summary.results.push({
        residentId: row.id,
        phone,
        status: "failed",
        reason: message,
      })
      await logGraphEvent(supabase, {
        landlord_id: landlordId,
        event_type: "tenant.activation_sms_failed",
        source: "edge_function",
        actor_type: "system",
        resident_id: row.id,
        metadata: {
          message: `Welcome text to ${
            row.full_name?.trim() || "resident"
          } could not be sent.`,
          reason: message,
          phone: normalizeSmsPhone(phone),
          sms_number_id: line.id,
          from_number: line.phone,
          provider,
        },
      })
    }
  }

  console.info("[tenantActivation] activation run complete", {
    landlordId,
    attempted: summary.attempted,
    sent: summary.sent,
    skipped: summary.skipped,
    failed: summary.failed,
  })

  return summary
}
