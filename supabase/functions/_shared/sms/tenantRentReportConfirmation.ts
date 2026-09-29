/**
 * Landlord YES / NO / corrected-$ confirmation for a tenant-reported rent payment.
 * Pending ask: intake_state.awaiting_tenant_rent_report_confirmation
 * (same shape as awaiting_invoice_paid_confirmation).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1"
import {
  formatTenantRentAmount,
  parseMoneyAmountFromSms,
  roundRentCents,
} from "./tenantRentReplyParse.ts"
import { matchShortReplyToken } from "./shortReplyTokens.ts"

export const TENANT_RENT_REPORT_CONFIRM_TTL_MS = 24 * 60 * 60 * 1000

export type AwaitingTenantRentReportConfirmation = {
  runId: string
  residentId: string
  residentConversationId: string
  ledgerEventId: string | null
  reportedAmount: number
  amountDue: number
  remainingDue: number
  unitLabel?: string | null
  residentName?: string | null
  billingPeriod?: string | null
  kind: "paid" | "partial"
  askedAt: string
  expiresAt: string
}

export type TenantRentReportConfirmReply =
  | { action: "confirm" }
  | { action: "correct"; amount: number }
  | { action: "reject" }
  | { action: "unclear" }
  | { action: "amount_ambiguous" }

export function serializeAwaitingTenantRentReportConfirmation(
  awaiting: AwaitingTenantRentReportConfirmation,
): Record<string, unknown> {
  return {
    run_id: awaiting.runId,
    resident_id: awaiting.residentId,
    resident_conversation_id: awaiting.residentConversationId,
    ledger_event_id: awaiting.ledgerEventId,
    reported_amount: awaiting.reportedAmount,
    amount_due: awaiting.amountDue,
    remaining_due: awaiting.remainingDue,
    unit_label: awaiting.unitLabel ?? null,
    resident_name: awaiting.residentName ?? null,
    billing_period: awaiting.billingPeriod ?? null,
    kind: awaiting.kind,
    asked_at: awaiting.askedAt,
    expires_at: awaiting.expiresAt,
  }
}

function parseAwaitingRow(
  row: Record<string, unknown>,
): AwaitingTenantRentReportConfirmation | null {
  const runId =
    (typeof row.run_id === "string" && row.run_id.trim()) ||
    (typeof row.runId === "string" && row.runId.trim()) ||
    ""
  const residentId =
    (typeof row.resident_id === "string" && row.resident_id.trim()) ||
    (typeof row.residentId === "string" && row.residentId.trim()) ||
    ""
  const residentConversationId =
    (typeof row.resident_conversation_id === "string" &&
      row.resident_conversation_id.trim()) ||
    (typeof row.residentConversationId === "string" &&
      row.residentConversationId.trim()) ||
    ""
  if (!runId || !residentId || !residentConversationId) return null

  const num = (v: unknown): number => {
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string" && v.trim()) {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
    return 0
  }

  const kindRaw = String(row.kind ?? "partial").toLowerCase()
  const kind: "paid" | "partial" = kindRaw === "paid" ? "paid" : "partial"
  const askedAt =
    (typeof row.asked_at === "string" && row.asked_at) ||
    (typeof row.askedAt === "string" && row.askedAt) ||
    new Date().toISOString()
  const expiresAt =
    (typeof row.expires_at === "string" && row.expires_at) ||
    (typeof row.expiresAt === "string" && row.expiresAt) ||
    new Date(Date.parse(askedAt) + TENANT_RENT_REPORT_CONFIRM_TTL_MS).toISOString()

  const ledgerRaw = row.ledger_event_id ?? row.ledgerEventId
  return {
    runId,
    residentId,
    residentConversationId,
    ledgerEventId: typeof ledgerRaw === "string" && ledgerRaw.trim()
      ? ledgerRaw.trim()
      : null,
    reportedAmount: num(row.reported_amount ?? row.reportedAmount),
    amountDue: num(row.amount_due ?? row.amountDue),
    remainingDue: num(row.remaining_due ?? row.remainingDue),
    unitLabel:
      (typeof row.unit_label === "string" && row.unit_label) ||
      (typeof row.unitLabel === "string" && row.unitLabel) ||
      null,
    residentName:
      (typeof row.resident_name === "string" && row.resident_name) ||
      (typeof row.residentName === "string" && row.residentName) ||
      null,
    billingPeriod:
      (typeof row.billing_period === "string" && row.billing_period) ||
      (typeof row.billingPeriod === "string" && row.billingPeriod) ||
      null,
    kind,
    askedAt,
    expiresAt,
  }
}

export function readAwaitingTenantRentReportConfirmations(
  intakeState: unknown,
): AwaitingTenantRentReportConfirmation[] {
  if (!intakeState || typeof intakeState !== "object") return []
  const raw = (intakeState as Record<string, unknown>)
    .awaiting_tenant_rent_report_confirmation
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
  const root = raw as Record<string, unknown>
  const reportsRaw = root.reports
  if (reportsRaw && typeof reportsRaw === "object" && !Array.isArray(reportsRaw)) {
    const out: AwaitingTenantRentReportConfirmation[] = []
    for (const value of Object.values(reportsRaw as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue
      const parsed = parseAwaitingRow(value as Record<string, unknown>)
      if (parsed) out.push(parsed)
    }
    return out
  }
  const legacy = parseAwaitingRow(root)
  return legacy ? [legacy] : []
}

export function readAwaitingTenantRentReportConfirmation(
  intakeState: unknown,
): AwaitingTenantRentReportConfirmation | null {
  return readAwaitingTenantRentReportConfirmations(intakeState)[0] ?? null
}

export function upsertAwaitingTenantRentReportConfirmation(
  priorIntake: Record<string, unknown>,
  awaiting: AwaitingTenantRentReportConfirmation,
): Record<string, unknown> {
  const reports: Record<string, Record<string, unknown>> = {}
  for (const row of readAwaitingTenantRentReportConfirmations(priorIntake)) {
    reports[row.runId] = serializeAwaitingTenantRentReportConfirmation(row)
  }
  reports[awaiting.runId] = serializeAwaitingTenantRentReportConfirmation(awaiting)
  return {
    ...priorIntake,
    awaiting_tenant_rent_report_confirmation: { reports },
  }
}

export function removeAwaitingTenantRentReportConfirmation(
  priorIntake: Record<string, unknown>,
  runId: string,
): Record<string, unknown> {
  const reports: Record<string, Record<string, unknown>> = {}
  for (const row of readAwaitingTenantRentReportConfirmations(priorIntake)) {
    if (row.runId === runId) continue
    reports[row.runId] = serializeAwaitingTenantRentReportConfirmation(row)
  }
  const next = { ...priorIntake }
  if (Object.keys(reports).length === 0) {
    delete next.awaiting_tenant_rent_report_confirmation
  } else {
    next.awaiting_tenant_rent_report_confirmation = { reports }
  }
  return next
}

export function canHandleTenantRentReportConfirmation(input: {
  identityType: string
  intakeState: unknown
}): boolean {
  if (input.identityType === "vendor") return false
  return readAwaitingTenantRentReportConfirmations(input.intakeState).length > 0
}

export function isTenantRentReportConfirmExpired(
  ask: AwaitingTenantRentReportConfirmation,
  now = new Date(),
): boolean {
  const expires = Date.parse(ask.expiresAt)
  if (!Number.isFinite(expires)) return false
  return now.getTime() >= expires
}

export function buildTenantRentReportConfirmAskSms(
  ask: AwaitingTenantRentReportConfirmation,
): string {
  const unit = (ask.unitLabel ?? "").trim() || "their unit"
  const who = (ask.residentName ?? "").trim() || "A resident"
  const reported = formatTenantRentAmount(ask.reportedAmount)
  const due = formatTenantRentAmount(ask.amountDue)
  const remaining = formatTenantRentAmount(ask.remainingDue)
  const kindLine = ask.kind === "paid"
    ? `${who} at ${unit} says they paid rent in full (${reported} of ${due}).`
    : `${who} at ${unit} reported a partial rent payment of ${reported} (of ${due}; ${remaining} would remain).`

  return [
    kindLine,
    "",
    "Did you receive that amount?",
    "Reply YES to confirm, or reply with the amount you actually received (e.g. 650).",
    "Reply NO if you did not receive a payment.",
  ].join("\n")
}

export function buildTenantRentReportConfirmAckSms(params: {
  confirmedAmount: number
  remainingDue: number
  unitLabel?: string | null
}): string {
  const amount = formatTenantRentAmount(params.confirmedAmount)
  const unit = (params.unitLabel ?? "").trim() || "that unit"
  if (params.remainingDue <= 0.001) {
    return `Confirmed ${amount} received for ${unit}. Balance is paid in full.`
  }
  const remaining = formatTenantRentAmount(params.remainingDue)
  return `Confirmed ${amount} received for ${unit}. ${remaining} still due.`
}

export function buildTenantRentReportRejectAckSms(params: {
  unitLabel?: string | null
}): string {
  const unit = (params.unitLabel ?? "").trim() || "that unit"
  return `Noted — no payment received yet for ${unit}. We'll keep following up.`
}

export function unclearTenantRentReportConfirmReply(): string {
  return "Please reply YES to confirm the reported amount, NO if you did not receive it, or the dollar amount you actually received."
}

export function buildTenantRentReportTtlEscalationSms(
  ask: AwaitingTenantRentReportConfirmation,
): string {
  const unit = (ask.unitLabel ?? "").trim() || "a unit"
  const reported = formatTenantRentAmount(ask.reportedAmount)
  return [
    `Reminder: ${ask.residentName?.trim() || "A resident"} at ${unit} reported a rent payment of ${reported} and is waiting for confirmation.`,
    "",
    "Reply YES to confirm, NO if not received, or the amount you actually got.",
  ].join("\n")
}

/**
 * YES / confirm — NO / reject — or a corrected dollar amount.
 */
export function parseTenantRentReportConfirmReply(
  body: string,
): TenantRentReportConfirmReply {
  const normalized = body
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/g, "")
    .replace(/\s+/g, " ")
  if (!normalized) return { action: "unclear" }

  const yesHit = matchShortReplyToken(body, ["YES", "Y", "YEAH", "YEP", "CONFIRM", "CONFIRMED", "RECEIVED", "GOT IT"])
  const noHit = matchShortReplyToken(body, ["NO", "N", "NOPE", "NOT YET", "UNPAID", "NONE"])

  const money = parseMoneyAmountFromSms(body)

  // Bare YES (no conflicting amount) → confirm
  if (
    yesHit ||
    normalized === "yes" ||
    normalized === "y" ||
    normalized === "yeah" ||
    normalized === "yep" ||
    normalized === "confirm" ||
    normalized === "confirmed" ||
    normalized === "received" ||
    normalized === "got it"
  ) {
    if (money.status === "ok") {
      return { action: "correct", amount: money.amount }
    }
    return { action: "confirm" }
  }

  if (
    noHit ||
    normalized === "no" ||
    normalized === "n" ||
    normalized === "nope" ||
    normalized === "not yet" ||
    normalized === "unpaid" ||
    normalized === "none" ||
    normalized === "not received" ||
    normalized === "didn't receive" ||
    normalized === "didnt receive"
  ) {
    return { action: "reject" }
  }

  if (money.status === "ambiguous") return { action: "amount_ambiguous" }
  if (money.status === "ok") {
    return { action: "correct", amount: roundRentCents(money.amount) }
  }

  return { action: "unclear" }
}

export async function loadConversationIntake(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("sms_conversations")
    .select("intake_state")
    .eq("id", conversationId)
    .maybeSingle()
  if (data?.intake_state && typeof data.intake_state === "object") {
    return data.intake_state as Record<string, unknown>
  }
  return {}
}

export async function persistTenantRentReportConfirmIntake(
  supabase: SupabaseClient,
  conversationId: string,
  intake: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from("sms_conversations")
    .update({
      intake_state: intake,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId)
}
