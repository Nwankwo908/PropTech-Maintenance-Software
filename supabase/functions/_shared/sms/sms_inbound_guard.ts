/**
 * Inbound debounce, duplicate-SID short-circuit, and outbound loop circuit breaker.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  normalizeSmsBody,
  type VendorScheduleFsmState,
} from "../vendor_schedule_fsm.ts"

/** Collapse rapid successive texts on the same thread. */
export const INBOUND_DEBOUNCE_MS = 2_500
/** How far back we look for duplicate / loop outbound bodies. */
export const OUTBOUND_LOOP_LOOKBACK_MS = 15 * 60 * 1000
export const OUTBOUND_LOOP_MAX_SAME = 1

export type SaveInboundResult = {
  messageId: string
  /** Webhook retry — row already existed. */
  duplicate: boolean
}

export type DebounceDecision =
  | { action: "process" }
  | {
    action: "skip"
    reason: "superseded_by_newer" | "duplicate_sid" | "empty_message"
  }

function mediaUrlCount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0
  return raw.filter((u) => typeof u === "string" && u.trim()).length
}

/** True when the inbound has usable text and/or MMS media. */
export function inboundHasContent(body: string, mediaUrls: unknown): boolean {
  return Boolean(body.trim()) || mediaUrlCount(mediaUrls) > 0
}

/**
 * If a newer inbound arrived within the debounce window after this message,
 * skip processing this one — the newer webhook will handle the latest text.
 *
 * Photo-only MMS (empty Body + MediaUrl) must still process — intake treats
 * that as "Maintenance issue (photo attached)".
 */
export async function decideInboundDebounce(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    messageId: string
    debounceMs?: number
  },
): Promise<DebounceDecision> {
  const windowMs = params.debounceMs ?? INBOUND_DEBOUNCE_MS

  const { data: self } = await supabase
    .from("sms_messages")
    .select("id, created_at, body, media_urls")
    .eq("id", params.messageId)
    .maybeSingle()

  if (!self?.created_at) return { action: "process" }
  const body = typeof self.body === "string" ? self.body.trim() : ""
  if (!inboundHasContent(body, self.media_urls)) {
    return { action: "skip", reason: "empty_message" }
  }

  const selfAt = new Date(self.created_at as string).getTime()
  const horizon = new Date(selfAt + windowMs).toISOString()

  const { data: newer } = await supabase
    .from("sms_messages")
    .select("id, created_at")
    .eq("conversation_id", params.conversationId)
    .eq("direction", "inbound")
    .gt("created_at", self.created_at as string)
    .lte("created_at", horizon)
    .order("created_at", { ascending: false })
    .limit(1)

  if (newer && newer.length > 0) {
    return { action: "skip", reason: "superseded_by_newer" }
  }
  return { action: "process" }
}

/**
 * Circuit breaker: suppress outbound if the same normalized body was
 * recently *sent* on this conversation (sms_messages).
 *
 * Do not use schedule FSM recentOutboundNorm here — confirm / soft-confirm
 * paths record the intended reply on the FSM before trySendAutoReply runs,
 * which would false-trip and silently drop the real SMS.
 */
export async function shouldTripOutboundCircuit(
  supabase: SupabaseClient,
  params: {
    conversationId: string
    body: string
    /** @deprecated Ignored — kept for call-site compatibility. */
    scheduleState?: VendorScheduleFsmState | null
    lookbackMs?: number
    maxSame?: number
  },
): Promise<{ trip: boolean; reason?: string }> {
  const body = params.body.trim()
  if (!body) return { trip: true, reason: "empty" }

  const maxSame = params.maxSame ?? OUTBOUND_LOOP_MAX_SAME
  const lookbackMs = params.lookbackMs ?? OUTBOUND_LOOP_LOOKBACK_MS
  const since = new Date(Date.now() - lookbackMs).toISOString()
  const norm = normalizeSmsBody(body)

  const { data: rows } = await supabase
    .from("sms_messages")
    .select("body, created_at")
    .eq("conversation_id", params.conversationId)
    .eq("direction", "outbound")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20)

  let hits = 0
  for (const row of rows ?? []) {
    if (typeof row.body !== "string") continue
    if (normalizeSmsBody(row.body) === norm) hits += 1
    if (hits >= maxSame) {
      return { trip: true, reason: "db_recent_outbound" }
    }
  }
  return { trip: false }
}

/** Extract best-effort inbound timestamp from provider payload. */
export function inboundOccurredAt(
  rawPayload: Record<string, unknown> | null | undefined,
  fallback = new Date(),
): string {
  if (rawPayload && typeof rawPayload === "object") {
    const candidates = [
      rawPayload.DateSent,
      rawPayload.date_sent,
      rawPayload.ReceivedAt,
      rawPayload.received_at,
      rawPayload.sent_at,
      // Telnyx
      (rawPayload.data as Record<string, unknown> | undefined)?.occurred_at,
      (rawPayload.data as Record<string, unknown> | undefined)?.received_at,
    ]
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        const t = new Date(c).getTime()
        if (!Number.isNaN(t)) return new Date(t).toISOString()
      }
      if (typeof c === "number" && Number.isFinite(c)) {
        // seconds vs ms
        const ms = c < 2_000_000_000 ? c * 1000 : c
        return new Date(ms).toISOString()
      }
    }
  }
  return fallback.toISOString()
}
