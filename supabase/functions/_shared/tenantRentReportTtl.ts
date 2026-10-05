/**
 * Cron: escalate stale landlord confirms for tenant-reported rent payments.
 * Mirrors schedule FSM TTL — asks expire after TENANT_RENT_REPORT_CONFIRM_TTL_MS.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { loadLandlordOperationalSettings } from "./landlordNotificationPrefs.ts"
import { isRentCollectionPaused } from "./engine/rentCollectionPolicy.ts"
import { notifyLandlordNeedsAttention } from "./landlordAttentionNotify.ts"
import { sendInboundAutoReply } from "./sms/inboundReply.ts"
import { findActiveLandlordMainNumber } from "./sms/landlordSmsOnboarding.ts"
import { smsProviderNameForSend } from "./sms/providerFactory.ts"
import {
  buildTenantRentReportTtlEscalationSms,
  isTenantRentReportConfirmExpired,
  loadConversationIntake,
  persistTenantRentReportConfirmIntake,
  readAwaitingTenantRentReportConfirmations,
  TENANT_RENT_REPORT_CONFIRM_TTL_MS,
  upsertAwaitingTenantRentReportConfirmation,
  type AwaitingTenantRentReportConfirmation,
} from "./sms/tenantRentReportConfirmation.ts"

export { TENANT_RENT_REPORT_CONFIRM_TTL_MS }

export type TenantRentReportTtlSummary = {
  scanned: number
  expired: number
  escalated: number
  skipped: number
  dryRun: boolean
}

function bumpExpiresAt(
  ask: AwaitingTenantRentReportConfirmation,
  now: Date,
): AwaitingTenantRentReportConfirmation {
  return {
    ...ask,
    askedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + TENANT_RENT_REPORT_CONFIRM_TTL_MS)
      .toISOString(),
  }
}

/**
 * Find landlord threads with an expired tenant-rent-report confirm ask and
 * re-nudge + escalate. Does not leave the ask unbounded — each expiry re-asks
 * once and logs; subsequent crons keep nudging on the refreshed TTL.
 */
export async function processTenantRentReportConfirmTtl(
  supabase: SupabaseClient,
  options?: {
    landlordId?: string | null
    now?: Date
    limit?: number
    dryRun?: boolean
  },
): Promise<TenantRentReportTtlSummary> {
  const now = options?.now ?? new Date()
  const limit = options?.limit ?? 40
  const dryRun = options?.dryRun === true

  let q = supabase
    .from("sms_conversations")
    .select("id, landlord_id, intake_state, external_phone_number")
    .not("intake_state", "is", null)
    .order("updated_at", { ascending: true })
    .limit(200)
  if (options?.landlordId?.trim()) {
    q = q.eq("landlord_id", options.landlordId.trim())
  }

  const { data: rows, error } = await q
  if (error) {
    console.error("[tenant-rent-report-ttl] list conversations", error.message)
    return { scanned: 0, expired: 0, escalated: 0, skipped: 0, dryRun }
  }

  let scanned = 0
  let expired = 0
  let escalated = 0
  let skipped = 0

  for (const row of rows ?? []) {
    if (expired >= limit) break
    const intake =
      row.intake_state && typeof row.intake_state === "object"
        ? (row.intake_state as Record<string, unknown>)
        : null
    if (!intake) continue
    const pending = readAwaitingTenantRentReportConfirmations(intake)
    if (pending.length === 0) continue
    scanned += 1

    const landlordId = String(row.landlord_id ?? "").trim()
    const conversationId = String(row.id ?? "").trim()
    if (!landlordId || !conversationId) {
      skipped += 1
      continue
    }

    const operational = await loadLandlordOperationalSettings(supabase, landlordId)
    if (isRentCollectionPaused(operational.rentCollectionPaused)) {
      // Drop pending confirms while rent is paused — no landlord re-nudge.
      if (!dryRun) {
        const prior = await loadConversationIntake(supabase, conversationId)
        if (readAwaitingTenantRentReportConfirmations(prior).length > 0) {
          const cleared = { ...(prior ?? {}) }
          delete cleared.awaiting_tenant_rent_report_confirmation
          await persistTenantRentReportConfirmIntake(
            supabase,
            conversationId,
            cleared,
          )
        }
      }
      skipped += 1
      continue
    }

    for (const ask of pending) {
      if (!isTenantRentReportConfirmExpired(ask, now)) continue
      expired += 1

      if (dryRun) continue

      const body = buildTenantRentReportTtlEscalationSms(ask)
      const main = await findActiveLandlordMainNumber(supabase, landlordId)
      const to = typeof row.external_phone_number === "string"
        ? row.external_phone_number.trim()
        : ""

      if (main?.id && main.phone_number && to) {
        const providerName = smsProviderNameForSend({
          landlordId,
          lineProvider: main.provider,
        })
        await sendInboundAutoReply(supabase, {
          conversationId,
          landlordId,
          fromNumber: main.phone_number,
          toNumber: to,
          body,
          provider: providerName,
          source: "tenant_rent_report_confirm_ttl",
        })
      }

      await notifyLandlordNeedsAttention(supabase, {
        landlordId,
        kind: "late_rent",
        headline: "Tenant rent report still needs confirmation",
        detail:
          `${ask.residentName?.trim() || "A resident"} at ${ask.unitLabel?.trim() || "their unit"} reported ${ask.reportedAmount} and no confirmation came in.`,
        idempotencyKey:
          `rent-report-ttl:${ask.runId}:${ask.expiresAt}`,
        residentId: ask.residentId,
        workflowRunId: ask.runId,
      })

      const prior = await loadConversationIntake(supabase, conversationId)
      await persistTenantRentReportConfirmIntake(
        supabase,
        conversationId,
        upsertAwaitingTenantRentReportConfirmation(
          prior,
          bumpExpiresAt(ask, now),
        ),
      )

      await recordActivityLog(supabase, {
        landlordId,
        eventType: "rent.tenant_payment_report_confirm_ttl",
        source: "automation",
        actorType: "system",
        residentId: ask.residentId,
        workflowRunId: ask.runId,
        workflowTemplateId: "rent_collection",
        conversationId,
        metadata: {
          message:
            "Rent payment report confirmation timed out — property team re-notified.",
          reported_amount: ask.reportedAmount,
          expires_at: ask.expiresAt,
          ttl_ms: TENANT_RENT_REPORT_CONFIRM_TTL_MS,
        },
      })

      escalated += 1
    }
  }

  return { scanned, expired, escalated, skipped, dryRun }
}
