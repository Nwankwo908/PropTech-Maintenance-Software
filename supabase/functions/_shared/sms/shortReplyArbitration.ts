/**
 * Ambiguous short-reply (YES/NO) arbitration.
 *
 * Governing rule: YES is contextual. A specific pending ask on the thread
 * (ticket-update confirm, schedule confirm, invoice paid, …) always beats a
 * blanket state notice like "rent collection is paused" that also parses YES
 * as PAID.
 */
import { isBareYesInvoicePaidReply } from "./invoicePaidConfirmation.ts"
import {
  isExplicitRentCollectionReply,
  looksLikeRentCollectionAsk,
} from "./tenantRentReplyParse.ts"
import { matchShortReplyToken } from "./shortReplyTokens.ts"

const RECENT_QUESTION_MS = 24 * 60 * 60 * 1000

export type SpecificYesNoPendingAskId =
  | "ticket_update_confirm"
  | "schedule_confirm"
  | "estimate_decision"
  | "landlord_vendor_choice"
  | "landlord_rent_receipt"
  | "tenant_rent_report_confirmation"
  | "invoice_paid_confirmation"
  | "hqs_confirm"

function intakeRecord(intakeState: unknown): Record<string, unknown> {
  if (intakeState && typeof intakeState === "object" && !Array.isArray(intakeState)) {
    return intakeState as Record<string, unknown>
  }
  return {}
}

function hasNonEmptyObject(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

/** True for bare YES / Y / yeah / yep (and trailing punctuation). */
export function isBareYesShortReply(body: string): boolean {
  return isBareYesInvoicePaidReply(body)
}

/** True for bare NO / N / nope / no thanks. */
export function isBareNoShortReply(body: string): boolean {
  const hit = matchShortReplyToken(body, ["NO", "N", "NOPE", "NO THANKS"])
  if (!hit) return false
  // Reject "no show" / "not yet paid" style longer phrases — token match alone
  // is enough when the normalized body collapses to the token.
  const normalized = body
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")
  return (
    normalized === "no" ||
    normalized === "n" ||
    normalized === "nope" ||
    normalized === "no thanks"
  )
}

export function isBareYesOrNoShortReply(body: string): boolean {
  return isBareYesShortReply(body) || isBareNoShortReply(body)
}

/**
 * Contextual pending YES/NO asks stored on the conversation.
 * These must win over blanket claimants (rent-pause PAID token, etc.).
 */
export function listSpecificYesNoPendingAsks(
  intakeState: unknown,
): SpecificYesNoPendingAskId[] {
  const intake = intakeRecord(intakeState)
  const out: SpecificYesNoPendingAskId[] = []

  if (intake.awaiting_ticket_update_confirm === true) {
    out.push("ticket_update_confirm")
  }
  if (
    intake.awaiting_schedule_confirmation === true ||
    hasNonEmptyObject(intake.awaiting_schedule_confirmation)
  ) {
    out.push("schedule_confirm")
  }
  if (hasNonEmptyObject(intake.awaiting_estimate_decision)) {
    out.push("estimate_decision")
  }
  if (hasNonEmptyObject(intake.awaiting_vendor_choice)) {
    out.push("landlord_vendor_choice")
  }
  if (
    intake.awaiting_landlord_rent_receipt === true ||
    hasNonEmptyObject(intake.awaiting_landlord_rent_receipt) ||
    hasNonEmptyObject(intake.awaiting_landlord_rent_amount) ||
    hasNonEmptyObject(intake.awaiting_landlord_rent_method)
  ) {
    out.push("landlord_rent_receipt")
  }
  if (hasNonEmptyObject(intake.awaiting_tenant_rent_report_confirmation)) {
    out.push("tenant_rent_report_confirmation")
  }
  if (hasNonEmptyObject(intake.awaiting_invoice_paid_confirmation)) {
    out.push("invoice_paid_confirmation")
  }
  if (intake.awaiting_hqs_confirm === true) {
    out.push("hqs_confirm")
  }

  return out
}

export function outboundQuestionWithin24h(
  lastOutbound: { body: string; sentAt: string } | null | undefined,
  now = new Date(),
): boolean {
  const body = lastOutbound?.body?.trim() ?? ""
  if (!body || looksLikeRentCollectionAsk(body)) return false
  if (!/\?\s*$/.test(body)) return false
  const sent = Date.parse(lastOutbound?.sentAt ?? "")
  if (!Number.isFinite(sent)) return false
  const delta = now.getTime() - sent
  return delta >= 0 && delta <= RECENT_QUESTION_MS
}

/**
 * Blanket rent-reply must not consume a reply that belongs to a more specific
 * pending ask, or to a question Ulo or the property team just asked.
 */
export function shouldYieldRentReplyToSpecificPendingAsk(input: {
  intakeState: unknown
  body: string
  lastOutbound?: { body: string; sentAt: string } | null
  now?: Date
}): boolean {
  const pending = listSpecificYesNoPendingAsks(input.intakeState).length > 0
  if (pending && isBareYesOrNoShortReply(input.body)) return true
  // "Today? Yes" is not a bare YES, but it is still an answer to the open ask.
  if (pending && /\byes\b/i.test(input.body) && !isBareYesShortReply(input.body)) {
    return true
  }
  if (
    outboundQuestionWithin24h(input.lastOutbound, input.now) &&
    !isExplicitRentCollectionReply(input.body)
  ) {
    return true
  }
  return false
}

/**
 * When two or more *specific* YES asks are open, clarify instead of racing.
 * Blanket rent-pause is not counted here — it yields instead.
 */
export function shouldClarifyAmbiguousYesPendingAsks(input: {
  intakeState: unknown
  body: string
}): boolean {
  if (!isBareYesShortReply(input.body)) return false
  return listSpecificYesNoPendingAsks(input.intakeState).length >= 2
}
