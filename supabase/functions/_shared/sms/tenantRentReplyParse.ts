/**
 * Parse tenant replies to rent-reminder SMS (PAID / PARTIAL / QUESTIONS).
 * Uses matchShortReplyToken for typo tolerance + phrase allowlists + inline $.
 */
import {
  checkPartialAmount,
  extractMoneyAmounts,
  parseMoneyAmountFromSms,
  roundRentCents,
} from "../engine/rentReceiptConfirmation.ts"
import { matchShortReplyToken, normalizeShortReply } from "./shortReplyTokens.ts"

export type TenantRentReplyKind = "paid" | "partial" | "questions"

export type TenantRentReplyParse =
  | {
      kind: "paid"
      amountStatus: "ok" | "missing"
      amount?: number
    }
  | {
      kind: "partial"
      amountStatus: "ok" | "missing" | "ambiguous"
      amount?: number
    }
  | { kind: "questions" }
  | null

const PAID_TOKENS = [
  "PAID",
  "SENT",
  "YES",
  "Y",
  "PAYMENT SENT",
  "I PAID",
  "IVE PAID",
  "I'VE PAID",
  "ALREADY PAID",
  "ALL PAID",
  "PAID IN FULL",
  "FULLY PAID",
  "PAYMENT DONE",
] as const

const PARTIAL_TOKENS = [
  "PARTIAL",
  "PART",
  "SOME",
  "PARTIALLY",
  "PARTIAL PAYMENT",
  "PAID SOME",
  "PAID PART",
  "PART PAID",
] as const

const QUESTIONS_TOKENS = [
  "QUESTIONS",
  "QUESTION",
  "HELP",
  "TALK",
  "CALL",
  "MANAGER",
  "PLAN",
  "ARRANGE",
] as const

/** Fuzzy single-token targets (typos like Parital / PARTAIL). */
const PAID_FUZZY = ["PAID", "SENT"] as const
const PARTIAL_FUZZY = ["PARTIAL", "PARTIALLY", "PART"] as const
const QUESTIONS_FUZZY = ["QUESTIONS", "QUESTION", "HELP"] as const

function stripMoneyForKeyword(body: string): string {
  return body
    .replace(
      /\$?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\$\d+(?:\.\d{1,2})?|(?<![A-Za-z0-9.])\d+(?:\.\d{1,2})?(?![A-Za-z0-9])/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
}

function matchesAllowlist(normalized: string, tokens: readonly string[]): boolean {
  const upper = normalized.toUpperCase()
  for (const token of tokens) {
    if (upper === token) return true
    if (upper.startsWith(`${token} `) || upper.endsWith(` ${token}`)) return true
  }
  return false
}

function detectKind(body: string): TenantRentReplyKind | null {
  const withoutMoney = stripMoneyForKeyword(body)
  const normalized = normalizeShortReply(withoutMoney || body)

  if (!normalized) return null

  // Prefer PARTIAL when the message signals a partial payment (including
  // "partial, I paid 700" where "I paid" would otherwise match PAID).
  if (
    /\b(partial(?:ly)?|part|some)\b/i.test(withoutMoney || body) ||
    matchesAllowlist(normalized.replace(/,/g, " "), PARTIAL_TOKENS) ||
    matchShortReplyToken(withoutMoney || body, PARTIAL_FUZZY) != null
  ) {
    return "partial"
  }

  if (
    matchesAllowlist(normalized.replace(/,/g, " "), PAID_TOKENS) ||
    matchShortReplyToken(withoutMoney || body, PAID_FUZZY) != null
  ) {
    return "paid"
  }

  if (
    matchesAllowlist(normalized.replace(/,/g, " "), QUESTIONS_TOKENS) ||
    matchShortReplyToken(withoutMoney || body, QUESTIONS_FUZZY) != null ||
    /\b(question|help|talk|call|manager|plan|arrange)\b/i.test(body)
  ) {
    return "questions"
  }

  // Bare short typo of PARTIAL/PAID with no other words.
  const fuzzyPartial = matchShortReplyToken(body, PARTIAL_FUZZY)
  if (fuzzyPartial) return "partial"
  const fuzzyPaid = matchShortReplyToken(body, PAID_FUZZY)
  if (fuzzyPaid) return "paid"
  const fuzzyQ = matchShortReplyToken(body, QUESTIONS_FUZZY)
  if (fuzzyQ) return "questions"

  return null
}

/**
 * Parse a tenant rent-reminder reply. Amounts are extracted when present
 * (e.g. "partial, I paid 700") without requiring a follow-up.
 */
export function parseTenantRentReply(body: string): TenantRentReplyParse {
  const kind = detectKind(body)
  if (!kind) return null

  if (kind === "questions") return { kind: "questions" }

  const money = parseMoneyAmountFromSms(body)
  if (kind === "paid") {
    if (money.status === "ok") {
      return { kind: "paid", amountStatus: "ok", amount: money.amount }
    }
    return { kind: "paid", amountStatus: "missing" }
  }

  // partial
  if (money.status === "ambiguous") {
    return { kind: "partial", amountStatus: "ambiguous" }
  }
  if (money.status === "ok") {
    return { kind: "partial", amountStatus: "ok", amount: money.amount }
  }
  return { kind: "partial", amountStatus: "missing" }
}

export function formatTenantRentAmount(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  })
}

export function buildTenantRentAmountAskSms(params: {
  amountDue: number
  reason?: "missing" | "ambiguous" | "not_positive" | "exceeds_balance"
}): string {
  const due = formatTenantRentAmount(params.amountDue)
  if (params.reason === "exceeds_balance") {
    return `That amount is more than the ${due} due. How much did you pay?`
  }
  if (params.reason === "not_positive") {
    return `The amount needs to be more than $0. How much did you pay toward the ${due} due?`
  }
  if (params.reason === "ambiguous") {
    return `I saw more than one dollar amount — how much did you pay toward the ${due} due? Reply with one number, like 700.`
  }
  return `Got it — a partial payment. How much did you pay? Reply with the dollar amount (for example 700). The balance due is ${due}.`
}

export function buildTenantRentReportAckSms(params: {
  kind: "paid" | "partial"
  reportedAmount: number
  remainingDue: number
}): string {
  const paid = formatTenantRentAmount(params.reportedAmount)
  const remaining = formatTenantRentAmount(params.remainingDue)
  if (params.kind === "paid" || params.remainingDue <= 0.001) {
    return [
      `Thanks — I've noted that you paid ${paid}.`,
      "That leaves $0.00 due.",
      "Your property manager will confirm once it's received.",
    ].join(" ")
  }
  return [
    `Thanks — I've noted a partial payment of ${paid}.`,
    `That leaves ${remaining} due.`,
    "Your property manager will confirm once it's received.",
  ].join(" ")
}

export function buildTenantRentCorrectedBalanceSms(params: {
  confirmedAmount: number
  remainingDue: number
}): string {
  const confirmed = formatTenantRentAmount(params.confirmedAmount)
  const remaining = formatTenantRentAmount(params.remainingDue)
  if (params.remainingDue <= 0.001) {
    return `Quick update from your property team: they confirmed ${confirmed} received. Your rent balance is now paid in full.`
  }
  return `Quick update from your property team: they confirmed ${confirmed} received. That leaves ${remaining} due.`
}

export function buildTenantRentQuestionsHandoffSms(ticketRef?: string | null): string {
  const ref = (ticketRef ?? "").trim()
  if (ref) {
    return [
      `Got it — we've flagged this for your property manager (ref ${ref}).`,
      "They'll follow up shortly. Reply here anytime with more detail.",
    ].join(" ")
  }
  return "Got it — we've flagged this for your property manager. They'll follow up shortly."
}

export {
  checkPartialAmount,
  extractMoneyAmounts,
  parseMoneyAmountFromSms,
  roundRentCents,
}
