/**
 * End-of-conversation acknowledgment — whole-message closing phrases only.
 *
 * Same priority tier as the clarify-menu echo recognizer in handleOther:
 * after a real pending ask is ruled out, a bare "ok" / "thanks" after an
 * informational Ulo update gets a brief close instead of the generic menu.
 */
import { matchShortReplyToken } from "./shortReplyTokens.ts"
import type { InterpretationPendingContext } from "./inboundInterpretation.ts"
import type { SmsIntakeState } from "./residentIntakeTypes.ts"

/** Canonical phrases (uppercase for matchShortReplyToken). */
const CLOSE_ACK_PHRASES = [
  "OK",
  "OKAY",
  "K",
  "KK",
  "THANKS",
  "THANK YOU",
  "THANK U",
  "THX",
  "TY",
  "OK THANK YOU",
  "OKAY THANK YOU",
  "OK THANKS",
  "OKAY THANKS",
  "THANKS OK",
  "THANK YOU OK",
  "GOT IT",
  "GOTCHA",
  "SOUNDS GOOD",
  "SOUNDS GREAT",
  "PERFECT",
  "GREAT",
  "APPRECIATE IT",
  "APPRECIATED",
  "MUCH APPRECIATED",
  "ALL GOOD",
  "COOL",
  "AWESOME",
  "WILL DO",
] as const

/** Exact whole-message patterns including light punctuation / typos. */
const CLOSE_ACK_EXACT =
  /^(ok(ay)?|k|kk|thanks?|thank\s*u|thx|ty|ok(ay)?[\s,]+thanks?(?:\s*you)?|thanks?(?:\s*you)?[\s,]+ok(ay)?|got\s*it|gotcha|sounds?\s+(good|great)|perfect|great|appreciate(?:d| it)|much\s+appreciated|all\s+good|cool|awesome|will\s+do)([.!…]*)?$/i

export function normalizeCloseAckBody(body: string): string {
  return body
    .trim()
    .toLowerCase()
    .replace(/[.!…]+$/g, "")
    .replace(/[,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * True when the entire message is a closing acknowledgment — not a
 * substring. "ok, also my sink is leaking" returns false.
 */
export function isConversationCloseAck(body: string): boolean {
  const raw = body.trim()
  if (!raw) return false
  // Extra content after a comma / "also" / "but" is a new ask — never close.
  if (/[,;]/.test(raw) && !CLOSE_ACK_EXACT.test(raw)) return false
  if (/\b(also|but|and|plus|one more|another|furthermore)\b/i.test(raw)) {
    // Allow "ok thanks" / "thanks ok" — already covered by CLOSE_ACK_EXACT.
    if (!CLOSE_ACK_EXACT.test(raw)) return false
  }
  if (CLOSE_ACK_EXACT.test(raw)) return true
  return matchShortReplyToken(raw, CLOSE_ACK_PHRASES) != null
}

/**
 * Pending ask that "ok" / "sounds good" might be answering — do not close.
 * Registry handlers for YES/NO already run earlier; this covers intake /
 * interpretation pending flags that reach handleOther.
 */
export function hasOpenPendingAskForCloseAck(
  pending: InterpretationPendingContext | null | undefined,
  intake?: SmsIntakeState | null,
): boolean {
  if (!pending) return false
  if (pending.activeIntake) return true
  if (pending.awaitingTicketUpdateConfirm) return true
  if (pending.awaitingTicketCancelConfirm) return true
  if (pending.awaitingMoveOutConfirm) return true
  if (pending.awaitingWhichRequest) return true
  if (intake?.awaiting_related_confirm === true) return true
  if (intake?.awaiting_rent_balance_clarify === true) return true
  if (intake?.awaiting_which_request === true) return true
  return false
}

/**
 * True when Ulo's last outbound looks informational (status / update),
 * not a question waiting for YES/NO, an amount, or a menu choice.
 */
export function looksLikeInformationalOutbound(body: string): boolean {
  const t = body.trim()
  if (!t) return false
  if (/\breply\s+(yes|no|y\/n|with|1\b|2\b|3\b)/i.test(t)) return false
  if (/\b(yes or no|y or n)\b/i.test(t)) return false
  if (/\bwhat do you need\b/i.test(t)) return false
  if (/\ba repair,\s*something about rent\b/i.test(t)) return false
  if (/\bhow much\b|\bamount\b|\b\$\s*\?/i.test(t)) return false
  // Question marks usually mean a pending ask — allow rhetorical status lines.
  if (/\?\s*$/.test(t)) {
    if (/\b(keep you posted|we'll update|we will update|any questions)\b/i.test(t)) {
      return true
    }
    return false
  }
  return true
}

export function buildConversationCloseAckSms(firstName?: string | null): string {
  const who = firstName?.trim()
  if (who) {
    return `You're welcome, ${who} — we'll keep you posted.`
  }
  return "You're welcome — we'll keep you posted."
}
