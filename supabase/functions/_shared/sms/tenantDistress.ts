/**
 * Tenant distress — profanity, stop-texting language, or outbound loop flag.
 * Suppresses clarify menus and work-order append asks; hands off to staff.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import { recordActivityLog } from "../graph/recordActivityLog.ts"
import { notifyLandlordNeedsAttention } from "../landlordAttentionNotify.ts"
import { matchShortReplyToken } from "./shortReplyTokens.ts"

export const OUTBOUND_LOOP_FLAG_KEY = "outbound_identical_reply_loop_at"

export type TenantDistressReason =
  | "profanity"
  | "stop_texting"
  | "outbound_loop"

export type TenantDistressSignal = {
  distress: boolean
  reasons: TenantDistressReason[]
}

/** Clear stop-texting phrasing — not an open-ended keyword dump. */
const STOP_TEXTING_CLEAR =
  /\b(don'?t|do\s+not|stop|quit|cease)\s+(text|texting|messaging|sms|contact)(\s+me)?\b/i

const STOP_TEXTING_CANONICAL = [
  "DONT TEXT ME",
  "DON'T TEXT ME",
  "DO NOT TEXT ME",
  "STOP TEXTING ME",
  "STOP TEXTING",
  "QUIT TEXTING ME",
  "LEAVE ME ALONE",
  "STOP MESSAGING ME",
  "DONT MESSAGE ME",
] as const

/** Compact profanity signal — whole-word only. */
const PROFANITY =
  /\b(fuck(?:ing|ed|er|s)?|shit(?:ty|ting)?|bitch(?:es|ing)?|asshole|cunt|dickhead|motherfuck(?:er|ing)?|bullshit|goddamn|piss\s*off)\b/i

export function buildTenantDistressHandoffSms(firstName?: string | null): string {
  const who = (firstName ?? "").trim().split(/\s+/)[0] || "there"
  return [
    `Hi ${who},`,
    "",
    "I'm sorry this has been frustrating.",
    "",
    "A member of our team will follow up with you here shortly.",
  ].join("\n")
}

export function readOutboundLoopFlag(intakeState: unknown): string | null {
  if (!intakeState || typeof intakeState !== "object" || Array.isArray(intakeState)) {
    return null
  }
  const raw = (intakeState as Record<string, unknown>)[OUTBOUND_LOOP_FLAG_KEY]
  return typeof raw === "string" && raw.trim() ? raw.trim() : null
}

/** True when the inbound itself shows continued frustration (not "thanks" / "okay"). */
export function inboundLooksLikeContinuedFrustration(body: string): boolean {
  return looksLikeProfanity(body) || looksLikeStopTextingNearVerbatim(body)
}

/** Clear sticky loop flag so ordinary follow-ups never re-enter distress. */
export async function clearOutboundLoopFlag(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<boolean> {
  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  if (!conv?.intake_state || typeof conv.intake_state !== "object" ||
    Array.isArray(conv.intake_state)) {
    return false
  }
  const prior = { ...(conv.intake_state as Record<string, unknown>) }
  if (!(OUTBOUND_LOOP_FLAG_KEY in prior)) return false
  delete prior[OUTBOUND_LOOP_FLAG_KEY]
  await supabase
    .from("sms_conversations")
    .update({ intake_state: prior, updated_at: new Date().toISOString() })
    .eq("id", conversationId)
  return true
}

export function looksLikeProfanity(body: string): boolean {
  return PROFANITY.test(body.trim())
}

export function looksLikeExplicitStopTexting(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  if (STOP_TEXTING_CLEAR.test(text)) return true
  const hit = matchShortReplyToken(text, STOP_TEXTING_CANONICAL)
  return hit != null
}

/**
 * Ambiguous “leave me alone / stop contacting” phrasing → typo-tolerant
 * match against a small fixed canon (not an ever-growing keyword list).
 */
export function looksLikeStopTextingNearVerbatim(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  if (looksLikeExplicitStopTexting(text)) return true
  // Near-verbatim multi-word: normalize and compare loosely.
  const norm = text
    .toUpperCase()
    .replace(/[.!?]+$/g, "")
    .replace(/[^A-Z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (norm.length > 48) return false
  for (const canon of STOP_TEXTING_CANONICAL) {
    if (norm === canon) return true
    if (norm.includes(canon) && norm.length <= canon.length + 12) return true
  }
  return false
}

export function detectTenantDistressSignals(input: {
  body: string
  intakeState?: unknown
}): TenantDistressSignal {
  const reasons: TenantDistressReason[] = []
  if (looksLikeProfanity(input.body)) reasons.push("profanity")
  if (looksLikeStopTextingNearVerbatim(input.body)) reasons.push("stop_texting")
  // Sticky loop flag alone must NOT force distress on "thank you" / "okay".
  // Only honor it when this inbound itself shows continued frustration.
  if (
    readOutboundLoopFlag(input.intakeState) &&
    inboundLooksLikeContinuedFrustration(input.body)
  ) {
    reasons.push("outbound_loop")
  }
  return { distress: reasons.length > 0, reasons }
}

export function canHandleTenantDistress(input: {
  identityType: string | null | undefined
  body: string
  intakeState?: unknown
}): boolean {
  if (input.identityType !== "resident") return false
  return detectTenantDistressSignals({
    body: input.body,
    intakeState: input.intakeState,
  }).distress
}

/** Ordinary follow-up after a loop trip — clear the sticky flag. */
export function shouldClearOutboundLoopFlagOnInbound(input: {
  body: string
  intakeState?: unknown
}): boolean {
  if (!readOutboundLoopFlag(input.intakeState)) return false
  return !inboundLooksLikeContinuedFrustration(input.body)
}

/** Distress must never offer YES/NO to append text onto a work order. */
export function shouldSuppressTicketAppendAsk(input: {
  body: string
  intakeState?: unknown
}): boolean {
  return detectTenantDistressSignals(input).distress
}

export async function handleTenantDistress(
  supabase: SupabaseClient,
  params: {
    landlordId: string
    conversationId: string
    messageId: string
    body: string
    residentId: string | null
    unitId?: string | null
    residentName?: string | null
    intakeState?: unknown
  },
): Promise<{ handled: true; replyBody: string; reasons: TenantDistressReason[] }> {
  const signal = detectTenantDistressSignals({
    body: params.body,
    intakeState: params.intakeState,
  })
  const reasons = signal.reasons
  const reasonLabel = reasons.join(",") || "unknown"
  const replyBody = buildTenantDistressHandoffSms(params.residentName)

  // Clear pending ticket-append / which-request asks so distress never lands on YES/NO.
  const { data: conv } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", params.conversationId)
    .maybeSingle()
  const prior = (conv?.intake_state && typeof conv.intake_state === "object" &&
      !Array.isArray(conv.intake_state))
    ? { ...(conv.intake_state as Record<string, unknown>) }
    : {}
  delete prior.awaiting_ticket_update_confirm
  delete prior.pending_ticket_update_id
  delete prior.pending_ticket_update_text
  delete prior.pending_ticket_update_kind
  delete prior.pending_ticket_update_media
  delete prior.awaiting_which_request
  delete prior.pending_which_request_ids
  delete prior.pending_which_request_intent
  delete prior.awaiting_related_confirm
  delete prior.clarify_menu_shown_at
  // Keep loop flag only if this inbound is not already clearing the frustration.
  if (reasons.includes("stop_texting") || reasons.includes("profanity")) {
    delete prior[OUTBOUND_LOOP_FLAG_KEY]
  }
  await supabase
    .from("sms_conversations")
    .update({ intake_state: prior, updated_at: new Date().toISOString() })
    .eq("id", params.conversationId)

  await recordActivityLog(supabase, {
    landlordId: params.landlordId,
    eventType: "sms.distress_detected",
    source: "sms",
    actorType: "resident",
    actorId: params.residentId,
    residentId: params.residentId,
    unitId: params.unitId ?? null,
    conversationId: params.conversationId,
    messageId: params.messageId,
    metadata: {
      message: "Resident distress detected; handed off to the property team.",
      reasons,
      reason: reasonLabel,
      body_preview: params.body.trim().slice(0, 160),
    },
  })

  void notifyLandlordNeedsAttention(supabase, {
    landlordId: params.landlordId,
    kind: "workflow_escalated",
    headline: "Resident needs a human follow-up",
    detail: params.body.trim().slice(0, 160) ||
      "They asked us to stop automated replies or used distressed language.",
    whyLine: reasons.includes("stop_texting")
      ? "They asked not to be texted by the automated assistant."
      : reasons.includes("profanity")
      ? "Their message included frustrated or abusive language."
      : "Automated replies were looping on their thread.",
    nextSteps: ["Follow up with the resident by text or phone"],
    idempotencyKey: `sms-distress:${params.conversationId}:${params.messageId}`,
    residentId: params.residentId,
    unitId: params.unitId ?? null,
  })

  return { handled: true, replyBody, reasons }
}
