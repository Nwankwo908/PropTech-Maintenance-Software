import { formatCurrency } from '@/lib/adminWorkflows'
import type { LateRentAccountReview } from '@/lib/lateRentAccountReview'

export type LateRentMessageAction = 'offer_payment_plan' | 'waive_late_fee'

export type LateRentChatMessage = {
  id: string
  sender: 'ulo' | 'landlord' | 'resident'
  body: string
  timeLabel: string
  aiLabel?: string
}

export type LateRentInstallmentPreview = {
  index: number
  amountCents: number
  amountLabel: string
  dueDate: Date
  dueLabel: string
}

export type LateRentAccountMessageBrief = {
  action: LateRentMessageAction
  workflowRunId: string
  residentId: string | null
  residentPhone: string | null
  residentName: string
  residentShortName: string
  residentInitials: string
  locationLabel: string
  balanceDueCents: number
  balanceDueLabel: string
  lateFeeCents: number
  lateFeeLabel: string
  installmentOptions: number[]
  defaultInstallments: number
  messages: LateRentChatMessage[]
}

const DEFAULT_LATE_FEE_CENTS = 9_000
const INSTALLMENT_OPTIONS = [2, 3, 4]

function firstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  return parts[0] || 'there'
}

function dollarsToCents(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0
  return Math.round(value * 100)
}

function parseMoneyLabelToCents(label: string): number {
  const cleaned = label.replace(/[^0-9.]/g, '')
  if (!cleaned) return 0
  const n = Number.parseFloat(cleaned)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n * 100)
}

function formatDueLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function startOfLocalDay(date = new Date()): Date {
  const d = new Date(date)
  d.setHours(12, 0, 0, 0)
  return d
}

/** Split balance into N installments (cents), first payment gets remainder pennies. */
export function splitBalanceIntoInstallments(
  totalCents: number,
  installments: number,
): number[] {
  const n = Math.max(1, Math.floor(installments))
  const safeTotal = Math.max(0, Math.round(totalCents))
  const base = Math.floor(safeTotal / n)
  const parts = Array.from({ length: n }, () => base)
  const remainder = safeTotal - base * n
  for (let i = 0; i < remainder; i += 1) parts[i] += 1
  return parts
}

/** Build installment schedule: first due in 5 days, then every 14 days. */
export function buildInstallmentPreview(
  totalCents: number,
  installments: number,
  now = new Date(),
): LateRentInstallmentPreview[] {
  const amounts = splitBalanceIntoInstallments(totalCents, installments)
  const anchor = startOfLocalDay(now)
  return amounts.map((amountCents, index) => {
    const due = new Date(anchor)
    due.setDate(due.getDate() + 5 + index * 14)
    return {
      index: index + 1,
      amountCents,
      amountLabel: formatCurrency(amountCents / 100),
      dueDate: due,
      dueLabel: formatDueLabel(due),
    }
  })
}

export function formatInstallmentPreviewLine(
  preview: LateRentInstallmentPreview[],
): string {
  return preview
    .map((row) => `Payment ${row.index}: ${row.amountLabel} due ${row.dueLabel}`)
    .join(' · ')
}

export function buildPaymentPlanSmsDraft(
  brief: LateRentAccountMessageBrief,
  installments: number,
  now = new Date(),
): string {
  const fname = firstName(brief.residentName)
  const preview = buildInstallmentPreview(brief.balanceDueCents, installments, now)
  const schedule = preview
    .map((row) => `Payment ${row.index} of ${preview.length}: ${row.amountLabel} due ${row.dueLabel}`)
    .join('; ')
  return (
    `Hi ${fname} — we can split your ${brief.balanceDueLabel} balance into ${installments} payments to catch up: ${schedule}. ` +
    `Reply YES to accept this plan, or tell me what schedule works better.`
  )
}

export function buildWaiveLateFeeSmsDraft(
  brief: LateRentAccountMessageBrief,
): string {
  const fname = firstName(brief.residentName)
  return (
    `Hi ${fname} — we've waived the ${brief.lateFeeLabel} late fee on your account. ` +
    `Your remaining balance is ${brief.balanceDueLabel}. Reply PAID when you've sent payment, or QUESTIONS if you need a payment plan.`
  )
}

function resolveLateFeeCents(review: LateRentAccountReview): number {
  const balance = review.insightsAccount.balanceDue
  const monthly = review.insightsAccount.monthlyRent
  if (
    balance != null &&
    monthly != null &&
    Number.isFinite(balance) &&
    Number.isFinite(monthly) &&
    balance > monthly
  ) {
    return Math.round((balance - monthly) * 100)
  }
  return DEFAULT_LATE_FEE_CENTS
}

function resolveBalanceCents(review: LateRentAccountReview): number {
  const fromFacts = dollarsToCents(review.insightsAccount.balanceDue)
  if (fromFacts > 0) return fromFacts
  return parseMoneyLabelToCents(review.balanceDueLabel)
}

function buildBaseBrief(
  action: LateRentMessageAction,
  review: LateRentAccountReview,
): LateRentAccountMessageBrief {
  const balanceDueCents = resolveBalanceCents(review)
  const lateFeeCents = resolveLateFeeCents(review)
  return {
    action,
    workflowRunId: review.workflowRunId,
    residentId: review.residentId,
    residentPhone: review.residentPhone,
    residentName: review.residentName,
    residentShortName: review.residentShortName,
    residentInitials: review.residentInitials,
    locationLabel: review.locationLabel,
    balanceDueCents,
    balanceDueLabel: formatCurrency(balanceDueCents / 100),
    lateFeeCents,
    lateFeeLabel: formatCurrency(lateFeeCents / 100),
    installmentOptions: INSTALLMENT_OPTIONS,
    defaultInstallments: 2,
    messages: [],
  }
}

export function buildLateRentPaymentPlanBrief(
  review: LateRentAccountReview,
): LateRentAccountMessageBrief {
  return buildBaseBrief('offer_payment_plan', review)
}

export function buildLateRentWaiveLateFeeBrief(
  review: LateRentAccountReview,
): LateRentAccountMessageBrief {
  return buildBaseBrief('waive_late_fee', review)
}

export async function sendLateRentAccountMessage(
  brief: LateRentAccountMessageBrief,
  message: string,
  landlordId: string,
  options?: { installments?: number },
): Promise<
  | {
      ok: true
      conversationId: string | null
      messageId: string | null
      balanceDueAfterWaiver?: number | null
      lateFeeWaived?: number | null
    }
  | { ok: false; error: string }
> {
  const trimmed = message.trim()
  if (!trimmed) return { ok: false, error: 'Message is empty.' }
  if (!brief.residentId) return { ok: false, error: 'No resident linked to this account.' }
  if (!brief.residentPhone) {
    return { ok: false, error: 'No phone number on file for this tenant.' }
  }

  const { postSendLateRentAccountMessage } = await import('@/api/sendLateRentAccountMessage')
  return postSendLateRentAccountMessage({
    workflowRunId: brief.workflowRunId,
    residentId: brief.residentId,
    residentPhone: brief.residentPhone,
    message: trimmed,
    action: brief.action,
    installments: options?.installments,
    lateFeeCents: brief.action === 'waive_late_fee' ? brief.lateFeeCents : undefined,
    landlordId,
  })
}

function formatSentTimeLabel(now = new Date()): string {
  return now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function appendLateRentSentMessage(
  brief: LateRentAccountMessageBrief,
  message: string,
  now = new Date(),
): LateRentAccountMessageBrief {
  const trimmed = message.trim()
  if (!trimmed) return brief
  return {
    ...brief,
    messages: [
      ...brief.messages,
      {
        id: `sent-${now.getTime()}`,
        sender: 'landlord',
        body: trimmed,
        timeLabel: formatSentTimeLabel(now),
      },
    ],
  }
}
