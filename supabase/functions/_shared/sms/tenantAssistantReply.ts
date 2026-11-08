/**
 * Tenant SMS assistant policy for non-repair "other" messages.
 *
 * Greetings / thanks / small talk → warm reply, never escalate.
 * During active intake, small talk re-asks the pending question and keeps state.
 * Unclear → one clarifying question, never escalate.
 * Human request / legal / complaint → escalate and only then say we passed it on.
 * Rent / lease stay on their dedicated handlers (not this module).
 */

import { LIFE_SAFETY_GUIDANCE } from "../../../../shared/maintenance/safetyGuidanceDelivery.ts"

export type AssistantOtherKind =
  | "small_talk"
  | "unclear"
  | "human_request"
  | "complaint_or_legal"

export type AssistantOtherReplyType =
  | "sms_small_talk"
  | "sms_clarify"
  | "sms_routed_to_landlord"

export type AssistantOtherPlan = {
  kind: AssistantOtherKind
  replyType: AssistantOtherReplyType
  /** Never true for greetings / unclear. */
  notifyStaff: boolean
  /** When true, do not release or rewrite intake_state. */
  preserveIntake: boolean
}

/** Whole-message greetings / thanks only — bare "ok" stays unclear. */
const GREETING_OR_THANKS =
  /^(hi|hello|hey|hiya|yo|sup|howdy|good\s*(morning|afternoon|evening)|thanks?(?:\s*(?:you|so\s*much))?|thx|ty|thank\s*you(?:\s*so\s*much)?|have\s*a\s*(good|nice)\s*(day|night)|👋|🙂|😊|👍)+[.!?]*$/i

const SMALL_TALK =
  /\b(how are you|how'?s it going|what'?s up|just saying hi|checking in|good to (?:meet|hear from) you)\b/i

const HUMAN_REQUEST =
  /\b((speak|talk|chat)\s+(to|with)\s+(a\s+)?(person|human|someone|manager|landlord|owner|agent|representative)|(?:want|need)\s+(?:a\s+)?(?:human|real\s+person)|real\s+person|human\s+please|call\s+me|have\s+(someone|(?:my|the)\s+landlord|a\s+manager)\s+call|connect\s+me\s+(to|with)|transfer\s+me)\b/i

const COMPLAINT_OR_LEGAL =
  /\b(complaint|complain|lawyer|attorney|legal\s+(notice|action|matter)|sue|lawsuit|court|harass(?:ment|ing)?|discriminat(?:e|ion)|fair\s+housing|habitability\s+claim|consumer\s+protection)\b/i

export function classifyAssistantOtherMessage(body: string): AssistantOtherKind {
  const text = body.trim()
  if (!text) return "unclear"
  if (HUMAN_REQUEST.test(text)) return "human_request"
  if (COMPLAINT_OR_LEGAL.test(text)) return "complaint_or_legal"
  if (GREETING_OR_THANKS.test(text) || SMALL_TALK.test(text)) return "small_talk"
  // Short non-repair notes without a clear ask → clarify once.
  if (text.split(/\s+/).length <= 6 && !/[?]/.test(text)) return "unclear"
  return "unclear"
}

export function shouldEscalateAssistantOther(kind: AssistantOtherKind): boolean {
  return kind === "human_request" || kind === "complaint_or_legal"
}

/** Pure planner for act-path side effects (tests assert notify/preserve). */
export function planAssistantOtherReply(input: {
  body: string
  activeIntake: boolean
}): AssistantOtherPlan {
  const kind = classifyAssistantOtherMessage(input.body)
  if (kind === "small_talk") {
    return {
      kind,
      replyType: "sms_small_talk",
      notifyStaff: false,
      preserveIntake: true,
    }
  }
  if (!shouldEscalateAssistantOther(kind)) {
    return {
      kind,
      replyType: "sms_clarify",
      notifyStaff: false,
      preserveIntake: true,
    }
  }
  return {
    kind,
    replyType: "sms_routed_to_landlord",
    notifyStaff: true,
    // Escalation may release the intake pin so the human thread can proceed.
    preserveIntake: false,
  }
}

export function buildSmallTalkSms(firstName: string): string {
  const who = firstName.trim() || "there"
  return [
    `Hi ${who},`,
    "",
    "This is Ulo AI.",
    "",
    "Good to hear from you — how can I help today?",
  ].join("\n")
}

/** Greeting during an open intake wizard — keep the pending question in play. */
export function buildSmallTalkDuringIntakeSms(
  firstName: string,
  pendingQuestion: string,
): string {
  const who = firstName.trim() || "there"
  const question = pendingQuestion.trim() ||
    "When you're ready, reply with a short description of what's going on."
  return [
    `Hi ${who},`,
    "",
    "This is Ulo AI.",
    "",
    "Happy to keep helping with your request.",
    "",
    question,
  ].join("\n")
}

export function buildUnclearClarifySms(firstName: string): string {
  const who = firstName.trim() || "there"
  return [
    `Hi ${who},`,
    "",
    "Happy to help. What do you need — a repair, something about rent or your lease, or something else?",
  ].join("\n")
}

export function buildEscalatedOtherSms(firstName: string, kind: AssistantOtherKind, residentMessage = ""): string {
  if (namesLandlord(residentMessage)) {
    const outcome = /\bcall\b/i.test(residentMessage)
      ? "I've asked your landlord to call you."
      : "I've passed your message to your landlord so they can help."
    return `Hi ${firstName.trim() || "there"},\n\n${outcome}`
  }
  return kind === "human_request"
    ? "I've passed your message to the property team."
    : "I've passed your message to the property team so they can help with this."
}

/** True only when this attempt handed a text to the property-team phone. */
export function propertyTeamWasTexted(smsSent: readonly string[]): boolean {
  return smsSent.some((phone) => phone.trim().length > 0)
}

/** Drop waiting / troubleshooting tips. Safety guidance stays. */
export function withoutWaitingTips(body: string): string {
  return body
    .split(/\n{2,}/)
    .filter((part) => !/^\s*Until help arrives\b/i.test(part.trim()))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Resident-facing line for a property-team alert, after delivery is known. */
export function propertyTeamAlertSentence(delivered: boolean): string {
  return delivered
    ? "I've alerted the property team so they can help as quickly as possible."
    : "I couldn't reach the property team just now."
}

/** Life-safety opener when the resident must leave / call 911 (gas, fire). */
export function buildEmergencySafetySms(input: {
  firstName: string
  leaveImmediately: boolean
  reason?: string | null
  handlingTip?: string | null
  /** True only after a text or email to the property team was delivered. */
  teamAlerted?: boolean
}): string {
  const who = input.firstName.trim() || "there"
  const lines = [`Hi ${who},`, ""]
  if (input.leaveImmediately) {
    lines.push(
      LIFE_SAFETY_GUIDANCE,
    )
  } else {
    lines.push(
      "If you or anyone else is in danger right now, call 911 first.",
    )
  }
  lines.push("")
  lines.push(propertyTeamAlertSentence(input.teamAlerted === true))
  if (input.reason?.trim()) {
    lines.push("")
    lines.push(input.reason.trim())
  }
  // Skip interim tips when they must leave immediately — safety first.
  if (!input.leaveImmediately && input.handlingTip?.trim()) {
    lines.push("")
    lines.push(input.handlingTip.trim())
  }
  return lines.join("\n")
}

/**
 * Same-day urgency (overflow, active leak, no heat, etc.) — alert the team
 * without treating it like a 911 life-safety event.
 */
export function buildSameDayUrgencySms(input: {
  firstName: string
  reason?: string | null
  handlingTip?: string | null
  /** True only after a text or email to the property team was delivered. */
  teamAlerted?: boolean
}): string {
  const who = input.firstName.trim() || "there"
  const lines = [
    `Hi ${who},`,
    "",
    "Thanks for letting us know — this needs same-day attention.",
    "",
    input.teamAlerted === true
      ? "I've alerted the property team so they can help quickly."
      : "I couldn't reach the property team just now.",
  ]
  if (input.reason?.trim()) {
    lines.push("")
    lines.push(input.reason.trim())
  }
  if (input.handlingTip?.trim()) {
    lines.push("")
    lines.push(input.handlingTip.trim())
  }
  return lines.join("\n")
}

/** Explicit confusion gets a focused recovery, never the same generic menu. */
export function needsConversationRecovery(body: string): boolean {
  return /\b(not understanding|don'?t understand|already told you|same question|going in circles|not what i (?:said|meant))\b/i.test(body)
}
export function buildConversationRecoverySms(firstName: string, pendingQuestion?: string): string {
  return `Hi ${firstName.trim() || "there"},\n\nI may have misunderstood. ${pendingQuestion?.trim() || "What did I get wrong about your request?"}`
}

export function isSimpleCourtesy(body: string): boolean {
  return GREETING_OR_THANKS.test(body.trim())
}

/** Mirror the requested role without changing routing or contact selection. */
function namesLandlord(message: string): boolean {
  return /\blandlord\b/i.test(message) && !/\bnot\s+(?:my\s+|the\s+)?landlord\b/i.test(message)
}

export function buildHandoffUnavailableSms(firstName: string, residentMessage = ""): string {
  const named = namesLandlord(residentMessage)
  const recipient = named ? "your landlord" : "the property team"
  const contact = named ? "your landlord" : "your property manager"
  const help = named ? "they can help" : "a person can help"
  return `Hi ${firstName.trim() || "there"},\n\nI couldn't notify ${recipient} automatically. Please contact ${contact} directly so ${help}.`
}
