/**
 * Cron: dispatch TTL_CHECK for vendor schedule FSM threads past expiresAt.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { sendVendorJobAlert } from "./sms/vendorSmsRouting.ts"
import {
  appendOutboundContext,
  isScheduleExpired,
  persistVendorScheduleFsm,
  readVendorScheduleFsm,
  reduceScheduleFsm,
  SCHEDULE_TTL_MS,
  type VendorScheduleStep,
} from "./vendor_schedule_fsm.ts"

const PRE_SCHEDULED_STEPS: VendorScheduleStep[] = [
  "awaiting_availability",
  "awaiting_confirmation",
  "awaiting_tenant_confirmation",
]

export type ScheduleFsmTtlSummary = {
  scanned: number
  expired: number
  notified: number
  skipped: number
}

/**
 * Find vendor SMS conversations with an open schedule FSM past TTL and
 * dispatch TTL_CHECK. Sends the effect prompt to the vendor when present.
 *
 * When `ticketIds` is set, only those work orders are considered.
 * When `force` is true, TTL is treated as expired (manual nudge from Property Insights).
 */
export async function processScheduleFsmTtlChecks(
  supabase: SupabaseClient,
  options?: {
    landlordId?: string | null
    now?: Date
    limit?: number
    ticketIds?: string[] | null
    force?: boolean
  },
): Promise<ScheduleFsmTtlSummary> {
  const now = options?.now ?? new Date()
  const limit = options?.limit ?? 40
  const ticketFilter = (options?.ticketIds ?? [])
    .map((id) => id.trim())
    .filter(Boolean)
  const ticketFilterSet = ticketFilter.length > 0 ? new Set(ticketFilter) : null
  const force = options?.force === true

  let q = supabase
    .from("sms_conversations")
    .select("id, landlord_id, vendor_id, intake_state, maintenance_request_id")
    .eq("conversation_type", "vendor_alert")
    .not("vendor_id", "is", null)
    .order("updated_at", { ascending: true })
    .limit(200)
  if (options?.landlordId?.trim()) {
    q = q.eq("landlord_id", options.landlordId.trim())
  }
  const { data: rows, error } = await q
  if (error) {
    console.error("[schedule-fsm-ttl] list conversations", error.message)
    return { scanned: 0, expired: 0, notified: 0, skipped: 0 }
  }

  let scanned = 0
  let expired = 0
  let notified = 0
  let skipped = 0
  const at = now.toISOString()

  for (const row of rows ?? []) {
    if (expired + skipped >= limit) break
    const intake =
      row.intake_state && typeof row.intake_state === "object"
        ? (row.intake_state as Record<string, unknown>)
        : null
    const prev = readVendorScheduleFsm(intake)
    if (!prev) continue
    if (!PRE_SCHEDULED_STEPS.includes(prev.step)) continue

    const ticketId =
      prev.ticketId ||
      (typeof row.maintenance_request_id === "string"
        ? row.maintenance_request_id
        : "") ||
      ""
    if (ticketFilterSet && !ticketFilterSet.has(ticketId)) {
      continue
    }

    scanned++
    if (!force && !isScheduleExpired(prev, now)) {
      skipped++
      continue
    }

    const transition = reduceScheduleFsm(prev, { type: "TTL_CHECK", at })
    if (transition.effect.kind === "noop") {
      skipped++
      continue
    }

    expired++
    let nextState = transition.state
    const prompt =
      transition.effect.kind === "tenant_confirm_expired" ||
        transition.effect.kind === "expired"
        ? transition.effect.prompt
        : null

    const conversationId = String(row.id)
    const landlordId = String(row.landlord_id)
    const vendorId = typeof row.vendor_id === "string" ? row.vendor_id : ""

    if (prompt && vendorId) {
      const { data: vendor } = await supabase
        .from("vendors")
        .select("phone")
        .eq("id", vendorId)
        .maybeSingle()
      const phone =
        typeof vendor?.phone === "string" ? vendor.phone.trim() : ""
      if (phone && ticketId) {
        const alert = await sendVendorJobAlert(supabase, {
          ticketId,
          vendorId,
          vendorPhone: phone,
          body: prompt,
          landlordId,
        })
        if (alert.ok) {
          notified++
          nextState = appendOutboundContext(nextState, prompt, at)
        }
      }
    }

    await persistVendorScheduleFsm(supabase, {
      conversationId,
      ticketId: ticketId || prev.ticketId,
      next: nextState,
      expectedRevision: prev.revision,
    })

    await recordActivityLog(supabase, {
      landlordId,
      eventType: "maintenance.schedule_fsm_ttl_expired",
      source: "automation",
      actorType: "system",
      vendorId: vendorId || null,
      maintenanceRequestId: ticketId || null,
      conversationId,
      metadata: {
        previous_step: prev.step,
        next_step: nextState.step,
        effect: transition.effect.kind,
        ttl_ms: SCHEDULE_TTL_MS,
        message:
          transition.effect.kind === "tenant_confirm_expired"
            ? "Resident never confirmed the visit window — vendor asked for another time."
            : "Vendor scheduling thread timed out before a visit was locked.",
      },
    }).catch(() => {})
  }

  return { scanned, expired, notified, skipped }
}
