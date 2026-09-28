/**
 * Shared gate for timer-/cron-originated outbound messages.
 * Suppresses stale or colliding automation before SMS goes out.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "./graph/recordActivityLog.ts"
import { ASK_CLOSING_WORK_STATUSES } from "./closeOpenAsksForTicket.ts"

/** Same recipient + same ticket automated SMS cooldown. */
export const AUTOMATED_MESSAGE_COOLDOWN_MS = 6 * 60 * 60 * 1000

/** Resident quiet hours in property/landlord local time (inclusive start, exclusive end next day). */
export const RESIDENT_QUIET_HOUR_START = 21 // 9 PM
export const RESIDENT_QUIET_HOUR_END = 8 // 8 AM

export type AutomatedMessageType =
  | "schedule_fsm_ttl_tenant_confirm"
  | "schedule_fsm_ttl_availability"
  | "schedule_fsm_ttl_generic"
  | "vendor_incident"
  | "workflow_escalation"
  | "lease_renewal"
  | "vendor_compliance"
  | "vendor_performance"
  | "ops_sms_cron"
  | "other"

export type AutomatedMessageAudience = "vendor" | "resident" | "landlord" | "ops"

export type ShouldSendAutomatedMessageInput = {
  ticketId?: string | null
  messageType: AutomatedMessageType
  audience: AutomatedMessageAudience
  /** Wall-clock / ISO instant the message refers to (e.g. pending visit). */
  referencedAt?: string | null
  /** Human window label (used when referencedAt missing). */
  referencedWindowText?: string | null
  /** Work statuses this message assumes are still open. */
  assumedOpenStatuses?: string[]
  recipientPhone?: string | null
  nowMs?: number
  cooldownMs?: number
  /** IANA TZ for quiet-hours (residents). */
  timeZone?: string | null
  /** Recent automated outbound count to this recipient about this ticket. */
  recentAutomatedToRecipient?: number
  currentVendorWorkStatus?: string | null
}

export type ShouldSendDecision =
  | { action: "send" }
  | { action: "suppress"; reason: string }
  | { action: "hold_quiet_hours"; reason: string }

export function isReferencedInstantPast(
  referencedAt: string | null | undefined,
  nowMs: number,
): boolean {
  if (!referencedAt?.trim()) return false
  const ms = new Date(referencedAt.trim()).getTime()
  if (!Number.isFinite(ms)) return false
  return ms < nowMs - 60_000
}

/** Best-effort: parse "Friday, Sep 18 at 4:30 PM" style labels against now. */
export function isReferencedWindowTextPast(
  windowText: string | null | undefined,
  nowMs: number,
  timeZone = "America/New_York",
): boolean {
  const raw = (windowText ?? "").trim()
  if (!raw) return false
  // Prefer an explicit ISO if present.
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    return isReferencedInstantPast(raw, nowMs)
  }
  try {
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return parsed < nowMs - 60_000
  } catch {
    /* fall through */
  }
  // Month day heuristic: "Sep 18" / "September 18" in current or prior year.
  const m = raw.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\b/i,
  )
  if (!m) return false
  const months: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  }
  const month = months[m[1]!.toLowerCase()]
  const day = Number(m[2])
  if (!month || !day) return false
  const year = new Date(nowMs).getUTCFullYear()
  // Interpret as noon local to avoid DST edge.
  const guess = Date.parse(
    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00`,
  )
  if (!Number.isFinite(guess)) return false
  // If guess is >30d in the future, try prior year.
  let candidate = guess
  if (candidate - nowMs > 30 * 24 * 60 * 60 * 1000) {
    candidate = Date.parse(
      `${year - 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00`,
    )
  }
  void timeZone
  return candidate < nowMs - 12 * 60 * 60 * 1000
}

export function isWithinResidentQuietHours(
  nowMs: number,
  timeZone: string,
): boolean {
  try {
    const hourStr = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(new Date(nowMs))
    let hour = Number(hourStr)
    if (hour === 24) hour = 0
    if (!Number.isFinite(hour)) return false
    return hour >= RESIDENT_QUIET_HOUR_START || hour < RESIDENT_QUIET_HOUR_END
  } catch {
    return false
  }
}

/**
 * Pure decision — pass loaded ticket/recent-message context from the async wrapper.
 */
export function decideShouldSendAutomatedMessage(
  input: ShouldSendAutomatedMessageInput,
): ShouldSendDecision {
  const nowMs = input.nowMs ?? Date.now()
  const status = (input.currentVendorWorkStatus ?? "").trim().toLowerCase()

  if (status && ASK_CLOSING_WORK_STATUSES.has(status)) {
    if (input.messageType.startsWith("schedule_fsm_ttl")) {
      return {
        action: "suppress",
        reason: `ticket_status_${status}`,
      }
    }
    const assumed = (input.assumedOpenStatuses ?? []).map((s) =>
      s.trim().toLowerCase()
    )
    if (assumed.length > 0 && !assumed.includes(status)) {
      return {
        action: "suppress",
        reason: `ticket_status_${status}`,
      }
    }
  }

  if (isReferencedInstantPast(input.referencedAt, nowMs)) {
    return { action: "suppress", reason: "referenced_instant_past" }
  }
  if (
    isReferencedWindowTextPast(
      input.referencedWindowText,
      nowMs,
      input.timeZone ?? "America/New_York",
    )
  ) {
    return { action: "suppress", reason: "referenced_window_past" }
  }

  const recent = input.recentAutomatedToRecipient ?? 0
  if (recent > 0) {
    return { action: "suppress", reason: "recipient_ticket_cooldown" }
  }

  if (
    input.audience === "resident" &&
    isWithinResidentQuietHours(
      nowMs,
      input.timeZone?.trim() || "America/New_York",
    )
  ) {
    return {
      action: "hold_quiet_hours",
      reason: "resident_quiet_hours_21_to_08",
    }
  }

  return { action: "send" }
}

export async function countRecentAutomatedToRecipient(
  supabase: SupabaseClient,
  params: {
    ticketId: string
    recipientPhone: string
    sinceIso: string
  },
): Promise<number> {
  const phone = params.recipientPhone.trim()
  const ticketId = params.ticketId.trim()
  if (!phone || !ticketId) return 0

  const { data: convos } = await supabase
    .from("sms_conversations")
    .select("id")
    .eq("maintenance_request_id", ticketId)
    .limit(20)
  const ids = (convos ?? []).map((c) => String(c.id)).filter(Boolean)
  if (ids.length === 0) return 0

  const { count, error } = await supabase
    .from("sms_messages")
    .select("id", { count: "exact", head: true })
    .in("conversation_id", ids)
    .eq("direction", "outbound")
    .gte("created_at", params.sinceIso)
  if (error) {
    console.warn("[shouldSendAutomated] recent count", error.message)
    return 0
  }
  return count ?? 0
}

export async function shouldSendAutomatedMessage(
  supabase: SupabaseClient,
  input: ShouldSendAutomatedMessageInput & {
    landlordId?: string | null
  },
): Promise<ShouldSendDecision> {
  const nowMs = input.nowMs ?? Date.now()
  let status = input.currentVendorWorkStatus ?? null
  const ticketId = input.ticketId?.trim() || ""

  if (ticketId && status == null) {
    const { data } = await supabase
      .from("maintenance_requests")
      .select("vendor_work_status, landlord_id")
      .eq("id", ticketId)
      .maybeSingle()
    status =
      typeof data?.vendor_work_status === "string"
        ? data.vendor_work_status
        : null
    if (!input.landlordId && typeof data?.landlord_id === "string") {
      input = { ...input, landlordId: data.landlord_id }
    }
  }

  let recent = input.recentAutomatedToRecipient
  if (
    recent == null &&
    ticketId &&
    input.recipientPhone?.trim()
  ) {
    const cooldownMs = input.cooldownMs ?? AUTOMATED_MESSAGE_COOLDOWN_MS
    recent = await countRecentAutomatedToRecipient(supabase, {
      ticketId,
      recipientPhone: input.recipientPhone,
      sinceIso: new Date(nowMs - cooldownMs).toISOString(),
    })
  }

  const decision = decideShouldSendAutomatedMessage({
    ...input,
    nowMs,
    currentVendorWorkStatus: status,
    recentAutomatedToRecipient: recent ?? 0,
  })

  if (decision.action !== "send") {
    const landlordId = input.landlordId?.trim() || null
    if (landlordId) {
      try {
        await recordActivityLog(supabase, {
          landlordId,
          eventType: "automation.message_suppressed",
          source: "automation",
          actorType: "system",
          maintenanceRequestId: ticketId || null,
          metadata: {
            message: `Suppressed automated ${input.messageType}: ${decision.reason}.`,
            message_type: input.messageType,
            reason: decision.reason,
            action: decision.action,
            audience: input.audience,
          },
        })
      } catch (e) {
        console.error("[shouldSendAutomated] suppress log", e)
      }
    } else {
      console.warn(
        JSON.stringify({
          event: "automation_message_suppressed",
          messageType: input.messageType,
          reason: decision.reason,
          ticketId: ticketId || null,
        }),
      )
    }
  }

  return decision
}
