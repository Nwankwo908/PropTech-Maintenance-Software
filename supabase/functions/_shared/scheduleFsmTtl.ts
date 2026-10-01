/**
 * Cron: dispatch TTL_CHECK for vendor schedule FSM threads past expiresAt.
 * Also reconciles zombie asks on tickets that already moved on.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import {
  closeOpenAsksForTicket,
  reconcileZombieScheduleAsks,
  reconcileZombieVendorAvailabilityAsks,
} from "./closeOpenAsksForTicket.ts"
import {
  shouldSendAutomatedMessage,
} from "./shouldSendAutomatedMessage.ts"
import { sendVendorJobAlert } from "./sms/vendorSmsRouting.ts"
import { shouldYieldToRecentStallFollowUp } from "../../../shared/ops/maintenanceStallFollowUp.ts"
import {
  appendOutboundContext,
  createIdleScheduleState,
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
  suppressed: number
  quietExpired: number
  reconciled: number
  dryRun: boolean
  wouldNotify?: Array<{ ticketId: string; effect: string; body: string }>
}

/**
 * Find vendor SMS conversations with an open schedule FSM past TTL and
 * dispatch TTL_CHECK. Sends the effect prompt to the vendor when present
 * — unless shouldSendAutomatedMessage suppresses (ticket advanced, window past).
 *
 * When `ticketIds` is set, only those work orders are considered.
 * When `force` is true, TTL is treated as expired (manual nudge from Property Insights).
 * When `dryRun` is true, report would-send without writing or SMS.
 */
export async function processScheduleFsmTtlChecks(
  supabase: SupabaseClient,
  options?: {
    landlordId?: string | null
    now?: Date
    limit?: number
    ticketIds?: string[] | null
    force?: boolean
    dryRun?: boolean
  },
): Promise<ScheduleFsmTtlSummary> {
  const now = options?.now ?? new Date()
  const limit = options?.limit ?? 40
  const dryRun = options?.dryRun === true
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
    return {
      scanned: 0,
      expired: 0,
      notified: 0,
      skipped: 0,
      suppressed: 0,
      quietExpired: 0,
      reconciled: 0,
      dryRun,
    }
  }

  let scanned = 0
  let expired = 0
  let notified = 0
  let skipped = 0
  let suppressed = 0
  let quietExpired = 0
  const wouldNotify: Array<{ ticketId: string; effect: string; body: string }> =
    []
  const at = now.toISOString()

  for (const row of rows ?? []) {
    if (expired + skipped + suppressed + quietExpired >= limit) break
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

    const { data: ticketRow } = ticketId
      ? await supabase
        .from("maintenance_requests")
        .select("vendor_work_status, landlord_id, stall_follow_up_sent_at")
        .eq("id", ticketId)
        .maybeSingle()
      : { data: null }

    const workStatus =
      typeof ticketRow?.vendor_work_status === "string"
        ? ticketRow.vendor_work_status
        : null
    const landlordId = String(
      row.landlord_id ||
        (typeof ticketRow?.landlord_id === "string"
          ? ticketRow.landlord_id
          : ""),
    )

    // Reverse coordination lock: soft stall nudge owns the SMS episode.
    if (
      shouldYieldToRecentStallFollowUp({
        stallFollowUpSentAt:
          typeof ticketRow?.stall_follow_up_sent_at === "string"
            ? ticketRow.stall_follow_up_sent_at
            : null,
        nowMs: now.getTime(),
      })
    ) {
      skipped++
      continue
    }

    // Ticket already past scheduling — close quietly, never message.
    if (
      workStatus &&
      ["in_progress", "completed", "cancelled", "archived"].includes(
        workStatus.toLowerCase(),
      )
    ) {
      if (!dryRun && ticketId) {
        await closeOpenAsksForTicket(
          supabase,
          ticketId,
          `schedule_fsm_ttl: ticket already ${workStatus}`,
        )
      }
      quietExpired++
      expired++
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
    const vendorId = typeof row.vendor_id === "string" ? row.vendor_id : ""
    const pendingAt =
      typeof prev.pendingScheduledAt === "string"
        ? prev.pendingScheduledAt
        : null
    const pendingWindow =
      typeof prev.pendingWindowText === "string" ? prev.pendingWindowText : null

    const messageType =
      transition.effect.kind === "tenant_confirm_expired"
        ? "schedule_fsm_ttl_tenant_confirm" as const
        : prev.step === "awaiting_availability"
        ? "schedule_fsm_ttl_availability" as const
        : "schedule_fsm_ttl_generic" as const

    let allowSend = Boolean(prompt && vendorId && ticketId)
    if (allowSend && prompt) {
      const gate = await shouldSendAutomatedMessage(supabase, {
        ticketId,
        landlordId: landlordId || null,
        messageType,
        audience: "vendor",
        referencedAt: pendingAt,
        referencedWindowText: pendingWindow,
        currentVendorWorkStatus: workStatus,
        recipientPhone: null, // filled below after vendor load
        nowMs: now.getTime(),
      })

      // Past window → quiet expire (no vendor SMS), even if status still accepted.
      if (
        gate.action === "suppress" &&
        (gate.reason === "referenced_window_past" ||
          gate.reason === "referenced_instant_past")
      ) {
        if (!dryRun) {
          const idle = createIdleScheduleState(ticketId)
          idle.revision = prev.revision + 1
          await persistVendorScheduleFsm(supabase, {
            conversationId,
            ticketId,
            next: idle,
            expectedRevision: prev.revision,
          })
          await recordActivityLog(supabase, {
            landlordId: landlordId || String(row.landlord_id),
            eventType: "maintenance.schedule_fsm_ttl_expired",
            source: "automation",
            actorType: "system",
            vendorId: vendorId || null,
            maintenanceRequestId: ticketId || null,
            conversationId,
            metadata: {
              previous_step: prev.step,
              next_step: "idle",
              effect: "quiet_expire_past_window",
              ttl_ms: SCHEDULE_TTL_MS,
              message:
                "Schedule confirmation TTL expired on a past visit window — closed quietly with no vendor SMS.",
            },
          }).catch(() => {})
        }
        quietExpired++
        allowSend = false
        continue
      }

      if (gate.action !== "send") {
        suppressed++
        if (!dryRun) {
          // Still advance FSM so we do not re-fire forever.
          await persistVendorScheduleFsm(supabase, {
            conversationId,
            ticketId: ticketId || prev.ticketId,
            next: nextState,
            expectedRevision: prev.revision,
          })
        }
        allowSend = false
        continue
      }
    }

    if (allowSend && prompt && vendorId) {
      const { data: vendor } = await supabase
        .from("vendors")
        .select("phone")
        .eq("id", vendorId)
        .maybeSingle()
      const phone =
        typeof vendor?.phone === "string" ? vendor.phone.trim() : ""

      if (phone && ticketId) {
        // Re-check cooldown with phone now that we have it.
        const gate2 = await shouldSendAutomatedMessage(supabase, {
          ticketId,
          landlordId: landlordId || null,
          messageType,
          audience: "vendor",
          referencedAt: pendingAt,
          referencedWindowText: pendingWindow,
          currentVendorWorkStatus: workStatus,
          recipientPhone: phone,
          nowMs: now.getTime(),
        })
        if (gate2.action !== "send") {
          suppressed++
          if (!dryRun) {
            await persistVendorScheduleFsm(supabase, {
              conversationId,
              ticketId,
              next: nextState,
              expectedRevision: prev.revision,
            })
          }
          continue
        }

        if (dryRun) {
          wouldNotify.push({
            ticketId,
            effect: transition.effect.kind,
            body: prompt,
          })
          notified++
          continue
        }

        const alert = await sendVendorJobAlert(supabase, {
          ticketId,
          vendorId,
          vendorPhone: phone,
          body: prompt,
          landlordId: landlordId || String(row.landlord_id),
        })
        if (alert.ok) {
          notified++
          nextState = appendOutboundContext(nextState, prompt, at)
        }
      }
    }

    if (dryRun) continue

    await persistVendorScheduleFsm(supabase, {
      conversationId,
      ticketId: ticketId || prev.ticketId,
      next: nextState,
      expectedRevision: prev.revision,
    })

    await recordActivityLog(supabase, {
      landlordId: landlordId || String(row.landlord_id),
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

  const reconcile = await reconcileZombieScheduleAsks(supabase, {
    limit: 40,
    dryRun,
  })
  const reconcileProbes = await reconcileZombieVendorAvailabilityAsks(supabase, {
    limit: 40,
    dryRun,
  })

  return {
    scanned,
    expired,
    notified,
    skipped,
    suppressed,
    quietExpired,
    reconciled: reconcile.closed + reconcileProbes.closed,
    dryRun,
    wouldNotify: dryRun ? wouldNotify : undefined,
  }
}
