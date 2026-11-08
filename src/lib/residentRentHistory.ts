import {
  formatCurrency,
  formatRentClassificationLabel,
  formatRentDueDate,
  type AdminRentCollectionRow,
  type AdminWorkflowDashboardData,
} from '@/lib/adminWorkflows'
import type { PropertyOperationsTimelineEvent } from '@/lib/propertyOperationsGraph'
import { formatUsd } from '@/lib/smartIntelligence/helpers'

export const RESIDENT_RENT_PAYMENT_TYPES = [
  { value: 'personal_payment', label: 'Personal payment' },
  { value: 'government_assisted', label: 'Government assisted' },
] as const

export type ResidentRentPaymentType = (typeof RESIDENT_RENT_PAYMENT_TYPES)[number]['value']

export function parseResidentRentPaymentType(
  value: string | null | undefined,
): ResidentRentPaymentType | null {
  const raw = (value ?? '').trim().toLowerCase()
  if (raw === 'personal_payment' || raw === 'government_assisted') return raw
  return null
}

export function formatResidentRentPaymentTypeLabel(
  value: string | null | undefined,
): string {
  const parsed = parseResidentRentPaymentType(value)
  if (!parsed) return '—'
  return RESIDENT_RENT_PAYMENT_TYPES.find((option) => option.value === parsed)?.label ?? '—'
}

export type ResidentRentHistoryItem = {
  id: string
  title: string
  detail: string
  statusLabel: string
  amountLabel: string | null
  occurredAt: string | null
  occurredLabel: string
  kind: 'period' | 'reminder'
}

function formatWhen(iso: string | null | undefined): string {
  const raw = (iso ?? '').trim()
  if (!raw) return '—'
  const when = new Date(raw)
  if (!Number.isFinite(when.getTime())) return '—'
  return when.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function occurredMs(iso: string | null | undefined): number {
  const ms = new Date((iso ?? '').trim()).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function rentRunsForResident(
  workflowData: AdminWorkflowDashboardData | null | undefined,
  residentId: string,
): AdminRentCollectionRow[] {
  const id = residentId.trim()
  if (!id || !workflowData) return []
  return (workflowData.rentCollection.runs ?? []).filter(
    (run) => (run.residentId ?? '').trim() === id,
  )
}

function isOpenRentRun(run: AdminRentCollectionRow): boolean {
  return (
    run.status !== 'completed' &&
    run.status !== 'cancelled' &&
    run.rentClassification !== 'paid' &&
    run.paymentStatus !== 'Paid'
  )
}

/**
 * Outstanding balance on the resident profile KPI — tied to open rent owed
 * (active rent_collection amount) with ledger balance as fallback/supplement.
 */
export function resolveResidentRentOwed(input: {
  residentId: string
  balanceDue: number
  monthlyRent?: number | null
  workflowData?: AdminWorkflowDashboardData | null
}): { amount: number; label: string; hasOpenRent: boolean } {
  const balance = input.balanceDue > 0.5 ? input.balanceDue : 0
  const openRuns = rentRunsForResident(input.workflowData, input.residentId).filter(isOpenRentRun)
  const run = openRuns[0] ?? null
  const periodAmount =
    (run?.amountDue != null && run.amountDue > 0 ? run.amountDue : null) ??
    (input.monthlyRent != null && input.monthlyRent > 0 && run ? input.monthlyRent : null)

  let amount = balance
  if (periodAmount != null && periodAmount > 0) {
    if (balance > periodAmount + 0.5) amount = balance
    else if (balance > 0 && Math.abs(balance - periodAmount) > 0.5) amount = periodAmount + balance
    else amount = periodAmount
  }

  return {
    amount,
    label: amount > 0 ? formatUsd(amount) : formatCurrency(0),
    hasOpenRent: Boolean(run) || amount > 0,
  }
}

export function buildResidentRentHistory(input: {
  residentId: string
  workflowData?: AdminWorkflowDashboardData | null
  operationsEvents?: PropertyOperationsTimelineEvent[]
}): ResidentRentHistoryItem[] {
  const items: ResidentRentHistoryItem[] = []
  const runs = rentRunsForResident(input.workflowData, input.residentId)

  for (const run of runs) {
    const period = (run.billingPeriod ?? '').trim()
    const due = formatRentDueDate(run.rentDueDate)
    const classification = formatRentClassificationLabel(run.rentClassification)
    const reminderBits = [
      run.reminderSmsSent ? 'SMS reminder sent' : null,
      run.reminderEmailSent ? 'Email reminder sent' : null,
    ].filter(Boolean)
    items.push({
      id: `period-${run.id}`,
      title: period || (due !== '—' ? `Rent due ${due}` : 'Rent period'),
      detail: [
        due !== '—' ? `Due ${due}` : null,
        classification !== '—' ? classification : null,
        reminderBits.length > 0 ? reminderBits.join(' · ') : null,
      ]
        .filter(Boolean)
        .join(' · '),
      statusLabel: run.paymentStatus || 'Unpaid',
      amountLabel: formatCurrency(run.amountDue),
      occurredAt: run.lastEventAt ?? run.startedAt ?? run.rentDueDate,
      occurredLabel: formatWhen(run.lastEventAt ?? run.startedAt ?? run.rentDueDate),
      kind: 'period',
    })
  }

  for (const event of input.operationsEvents ?? []) {
    if (event.eventType !== 'rent.reminder_sent') continue
    items.push({
      id: `reminder-${event.id}`,
      title: 'Rent reminder sent',
      detail: (event.message ?? event.label ?? 'Automatic rent reminder').trim() || 'Automatic rent reminder',
      statusLabel: 'Reminder',
      amountLabel: null,
      occurredAt: event.createdAt,
      occurredLabel: formatWhen(event.createdAt),
      kind: 'reminder',
    })
  }

  items.sort((a, b) => occurredMs(b.occurredAt) - occurredMs(a.occurredAt))
  return items
}
