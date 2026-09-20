/**
 * Tenant SMS assistant policy for non-repair "other" messages.
 *
 * Greetings / thanks / small talk → warm reply, never escalate.
 * Unclear → one clarifying question, never escalate.
 * Human request / legal / complaint → escalate and only then say we passed it on.
 * Rent / lease stay on their dedicated handlers (not this module).
 */

export type AssistantOtherKind =
  | "small_talk"
  | "unclear"
  | "human_request"
  | "complaint_or_legal"

const GREETING_OR_THANKS =
  /^(hi|hello|hey|hiya|yo|sup|howdy|good\s*(morning|afternoon|evening)|thanks?(?:\s*(?:you|so\s*much))?|thx|ty|thank\s*you(?:\s*so\s*much)?|ok(?:ay)?|cool|great|awesome|perfect|sounds?\s*good|have\s*a\s*(good|nice)\s*(day|night)|👋|🙂|😊|👍)+[.!?]*$/i

const SMALL_TALK =
  /\b(how are you|how'?s it going|what'?s up|just saying hi|checking in|good to (?:meet|hear from) you)\b/i

const HUMAN_REQUEST =
  /\b((speak|talk|chat)\s+(to|with)\s+(a\s+)?(person|human|someone|manager|landlord|owner|agent|representative)|real\s+person|human\s+please|call\s+me|have\s+(someone|a\s+manager)\s+call|connect\s+me\s+(to|with)|transfer\s+me)\b/i

const COMPLAINT_OR_LEGAL =
  /\b(complaint|complain|lawyer|attorney|legal\s+(notice|action|matter)|sue|lawsuit|court|harass(?:ment|ing)?|discriminat(?:e|ion)|fair\s+housing|habitability\s+claim|consumer\s+protection)\b/i

export function classifyAssistantOtherMessage(body: string): AssistantOtherKind {
  const text = body.trim()
  if (!text) return "unclear"
  if (GREETING_OR_THANKS.test(text) || SMALL_TALK.test(text)) return "small_talk"
  if (HUMAN_REQUEST.test(text)) return "human_request"
  if (COMPLAINT_OR_LEGAL.test(text)) return "complaint_or_legal"
  // Short non-repair notes without a clear ask → clarify once.
  if (text.split(/\s+/).length <= 6 && !/[?]/.test(text)) return "unclear"
  return "unclear"
}

export function shouldEscalateAssistantOther(kind: AssistantOtherKind): boolean {
  return kind === "human_request" || kind === "complaint_or_legal"
}

export function buildSmallTalkSms(firstName: string): string {
  const who = firstName.trim() || "there"
  return [
    `Hi ${who},`,
    "",
    "Good to hear from you — how can I help today?",
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

export function buildEscalatedOtherSms(firstName: string, kind: AssistantOtherKind): string {
  const who = firstName.trim() || "there"
  const why = kind === "human_request"
    ? "I've passed your message to the property team so someone can follow up with you here."
    : "I've passed your message to the property team so they can help with this."
  return [
    `Hi ${who},`,
    "",
    "This is the property management team.",
    "",
    why,
  ].join("\n")
}

/** Life-safety opener when urgency policy says leave immediately or danger is clear. */
export function buildEmergencySafetySms(input: {
  firstName: string
  leaveImmediately: boolean
  reason?: string | null
}): string {
  const who = input.firstName.trim() || "there"
  const lines = [`Hi ${who},`, ""]
  if (input.leaveImmediately) {
    lines.push(
      "If you smell gas, see fire, or anyone is in danger, leave right away and call 911.",
    )
  } else {
    lines.push(
      "If you or anyone else is in danger right now, call 911 first.",
    )
  }
  lines.push("")
  lines.push(
    "I'm alerting the property team now so they can help as quickly as possible.",
  )
  if (input.reason?.trim()) {
    lines.push("")
    lines.push(input.reason.trim())
  }
  return lines.join("\n")
}
