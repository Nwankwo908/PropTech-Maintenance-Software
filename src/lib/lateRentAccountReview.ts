import {
  formatCurrency,
  type AdminRentCollectionRow,
  type AdminWorkflowDashboardData,
} from '@/lib/adminWorkflows'

export type LateRentInsightTag = 'ON-TIME HISTORY' | 'ENGAGEMENT' | 'INTENT' | 'RISK'

export type LateRentInsightCard = {
  tag: LateRentInsightTag
  tagClassName: string
  text: string
}

export type LateRentRiskLevel = 'low' | 'medium' | 'high'

export type LateRentResidentContext = {
  status?: string | null
  moveInDate?: string | null
  balanceDue?: number | null
  phone?: string | null
}

export type LateRentAccountAction =
  | 'offer_payment_plan'
  | 'waive_late_fee'
  | 'mark_payment_received'

export const LATE_RENT_ACCOUNT_ACTION_LABELS: Record<LateRentAccountAction, string> = {
  offer_payment_plan: 'Offer payment plan',
  waive_late_fee: 'Waive late fee',
  mark_payment_received: 'Mark payment received',
}

/** Structured facts sent to generate-late-rent-insights (OpenAI). */
export type LateRentInsightsAccountFacts = {
  residentName: string
  locationLabel: string
  daysOverdue: number
  balanceDue: number | null
  monthlyRent: number | null
  workflowStatus: string
  rentClassification: string | null
  paymentIntent: string | null
  paymentStatus: string | null
  reminderSent: boolean
  reminderSmsSent: boolean
  reminderEmailSent: boolean
  leaseStatus: string | null
  moveInDate: string | null
  riskLevel: LateRentRiskLevel
}

export type LateRentAccountReview = {
  workflowRunId: string
  residentId: string | null
  residentName: string
  residentShortName: string
  residentInitials: string
  residentPhone: string | null
  leaseStatusLabel: string
  riskLabel: string
  riskClassName: string
  locationLabel: string
  communicationPrefLabel: string
  nextReminderLabel: string | null
  balanceDueLabel: string
  daysOverdue: number
  daysOverdueLabel: string
  monthlyRentLabel: string
  /** True when payment-plan SMS was already delivered for this run. */
  paymentPlanSmsSent: boolean
  /** True when late-fee waiver SMS was already delivered for this run. */
  lateFeeWaiverSmsSent: boolean
  /** Heuristic fallback; replaced by AI when generate-late-rent-insights succeeds. */
  insights: LateRentInsightCard[]
  insightsAccount: LateRentInsightsAccountFacts
}

const INSIGHT_TAG_STYLES: Record<LateRentInsightTag, string> = {
  'ON-TIME HISTORY': 'bg-[#dcfce7] text-[#008236]',
  ENGAGEMENT: 'bg-[#ffedd5] text-[#c2410c]',
  INTENT: 'bg-[#dcfce7] text-[#008236]',
  RISK: 'bg-[#dbeafe] text-[#1447e6]',
}

const RISK_BADGE: Record<
  LateRentRiskLevel,
  { label: string; className: string }
> = {
  low: { label: 'LOW RISK', className: 'bg-[#f3f4f6] text-[#364153]' },
  medium: { label: 'MEDIUM RISK', className: 'bg-[#ffedd5] text-[#c2410c]' },
  high: { label: 'HIGH RISK', className: 'bg-[#ffe2e2] text-[#c10007]' },
}

function readDaysOverdue(rentDueDate: string | null, now = Date.now()): number {
  if (!rentDueDate?.trim()) return 0
  const due = new Date(`${rentDueDate.trim().slice(0, 10)}T12:00:00`).getTime()
  if (Number.isNaN(due)) return 0
  const today = new Date(now)
  today.setHours(12, 0, 0, 0)
  const diffMs = today.getTime() - due
  if (diffMs <= 0) return 0
  return Math.max(1, Math.round(diffMs / 86_400_000))
}

function formatShortName(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Resident'
  if (parts.length === 1) return parts[0]
  return `${parts[0][0]}. ${parts[parts.length - 1]}`
}

function formatInitials(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

function formatLocation(propertyLabel: string | null, unitLabel: string | null): string {
  const building = propertyLabel?.trim() || 'Property'
  const unit = (unitLabel ?? '').trim()
  if (!unit) return building
  const displayUnit = /^\d/.test(unit) ? `Unit ${unit}` : unit
  return `${building} · ${displayUnit}`
}

function estimateMonthlyRent(amountDue: number | null, unitLabel: string | null): number {
  if (amountDue != null && amountDue > 0) return amountDue
  const unitNumber = Number.parseInt((unitLabel ?? '').replace(/\D/g, ''), 10)
  if (!Number.isFinite(unitNumber)) return 1800
  if (unitNumber >= 500) return 2400
  if (unitNumber >= 400) return 2200
  if (unitNumber >= 300) return 2000
  if (unitNumber >= 200) return 1850
  return 1650
}

function deriveRiskLevel(daysOverdue: number, row: AdminRentCollectionRow): LateRentRiskLevel {
  if (row.status === 'escalated' || daysOverdue >= 14) return 'high'
  if (daysOverdue >= 5 || row.paymentIntent === 'questions') return 'medium'
  return 'low'
}

function monthsOnTime(moveInDate: string | null | undefined, now = Date.now()): number | null {
  if (!moveInDate?.trim()) return null
  const moveIn = new Date(`${moveInDate.trim().slice(0, 10)}T12:00:00`).getTime()
  if (Number.isNaN(moveIn)) return null
  const months = Math.floor((now - moveIn) / (30 * 86_400_000))
  return months > 0 ? months : null
}

function buildOnTimeHistoryInsight(
  row: AdminRentCollectionRow,
  resident?: LateRentResidentContext | null,
): LateRentInsightCard {
  const months = monthsOnTime(resident?.moveInDate)
  const text =
    months != null && months >= 12
      ? `Paid on time for the past ${Math.min(months, 24)} months.`
      : months != null && months >= 3
        ? `Generally paid on time since move-in (${months} months).`
        : 'Limited payment history on file for this lease.'
  return {
    tag: 'ON-TIME HISTORY',
    tagClassName: INSIGHT_TAG_STYLES['ON-TIME HISTORY'],
    text,
  }
}

function buildEngagementInsight(row: AdminRentCollectionRow): LateRentInsightCard {
  let text = 'No reminder response recorded yet.'
  if (row.paymentIntent === 'paid') {
    text = 'Resident confirmed payment — verify ledger posting.'
  } else if (row.paymentIntent === 'partial') {
    text = 'Resident reported a partial payment — follow up on remaining balance.'
  } else if (row.reminderSent && row.paymentIntent === 'questions') {
    text = 'Reminder opened — resident replied with questions.'
  } else if (row.reminderSent) {
    text = 'Reminder opened but no payment received.'
  } else if (row.reminderSmsSent || row.reminderEmailSent) {
    text = 'Outreach sent — awaiting resident response.'
  }
  return {
    tag: 'ENGAGEMENT',
    tagClassName: INSIGHT_TAG_STYLES.ENGAGEMENT,
    text,
  }
}

function buildIntentInsight(row: AdminRentCollectionRow): LateRentInsightCard {
  let text = 'No payment commitment captured yet.'
  if (
    row.paymentIntent === 'questions' ||
    row.rentClassification === 'payment_plan_needed'
  ) {
    text = 'Resident requested an installment plan — willing to pay.'
  } else if (row.paymentIntent === 'partial') {
    text = 'Resident indicated partial payment — confirm amount and timing.'
  } else if (row.paymentIntent === 'paid') {
    text = 'Resident stated rent was paid — verify against ledger.'
  } else if (row.paymentStatus.toLowerCase().includes('awaiting')) {
    text = 'Payment link sent — resident has not completed checkout.'
  }
  return {
    tag: 'INTENT',
    tagClassName: INSIGHT_TAG_STYLES.INTENT,
    text,
  }
}

function buildRiskInsight(
  row: AdminRentCollectionRow,
  risk: LateRentRiskLevel,
  daysOverdue: number,
): LateRentInsightCard {
  const riskWord = risk === 'high' ? 'High' : risk === 'medium' ? 'Medium' : 'Low'
  const prior =
    row.status === 'escalated'
      ? 'Escalated to admin review.'
      : daysOverdue >= 7
        ? 'Multiple reminders sent without payment.'
        : 'No prior delinquency on this lease.'
  return {
    tag: 'RISK',
    tagClassName: INSIGHT_TAG_STYLES.RISK,
    text: `Classified as ${riskWord}. ${prior}`,
  }
}

function buildNextReminderLabel(row: AdminRentCollectionRow): string | null {
  if (row.paymentIntent === 'paid' || row.rentClassification === 'paid') return null
  const channel =
    row.reminderSmsSent && row.reminderEmailSent
      ? 'SMS + email'
      : row.reminderSmsSent
        ? 'SMS'
        : row.reminderEmailSent
          ? 'Email'
          : 'SMS'
  const anchor = row.lastEventAt ? new Date(row.lastEventAt) : new Date()
  const next = new Date(anchor)
  next.setDate(next.getDate() + 1)
  next.setHours(9, 0, 0, 0)
  const dayLabel =
    next.toDateString() === new Date().toDateString()
      ? 'Today'
      : next.toDateString() === new Date(Date.now() + 86_400_000).toDateString()
        ? 'Tomorrow'
        : next.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const timeLabel = next.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return `Next reminder · ${dayLabel} · ${timeLabel} (${channel})`
}

function resolveLeaseStatusLabel(status: string | null | undefined): string {
  const normalized = (status ?? 'active').trim().toLowerCase()
  if (normalized === 'pending') return 'LEASE PENDING'
  if (normalized === 'suspended') return 'LEASE SUSPENDED'
  if (normalized === 'past_resident') return 'PAST RESIDENT'
  return 'LEASE ACTIVE'
}

/** Active and escalated overdue rent_collection runs, most overdue first. */
export function collectLateRentReviewRuns(
  data: AdminWorkflowDashboardData,
): AdminRentCollectionRow[] {
  const seen = new Set<string>()
  const rows: AdminRentCollectionRow[] = []
  for (const row of [...data.rentCollection.overdue, ...data.rentCollection.escalatedResidents]) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    rows.push(row)
  }
  return rows.sort((a, b) => {
    const aDays = readDaysOverdue(a.rentDueDate)
    const bDays = readDaysOverdue(b.rentDueDate)
    return bDays - aDays
  })
}

export function applyLateRentInsightTexts(
  review: LateRentAccountReview,
  insights: Array<{ tag: LateRentInsightTag; text: string }>,
): LateRentAccountReview {
  const byTag = new Map(
    insights.map((item) => [item.tag, item.text.trim()] as const),
  )
  return {
    ...review,
    insights: review.insights.map((card) => {
      const next = byTag.get(card.tag)
      return next ? { ...card, text: next } : card
    }),
  }
}

export function buildLateRentAccountReview(
  row: AdminRentCollectionRow,
  resident?: LateRentResidentContext | null,
): LateRentAccountReview {
  const daysOverdue = readDaysOverdue(row.rentDueDate)
  const risk = deriveRiskLevel(daysOverdue, row)
  const riskBadge = RISK_BADGE[risk]
  const balanceDue = resident?.balanceDue ?? row.amountDue ?? 0
  const monthlyRent = estimateMonthlyRent(row.amountDue, row.unitLabel)
  const locationLabel = formatLocation(row.propertyLabel, row.unitLabel)
  const residentName = row.residentName?.trim() || 'Resident'
  const insightsAccount: LateRentInsightsAccountFacts = {
    residentName,
    locationLabel,
    daysOverdue,
    balanceDue: balanceDue > 0 ? balanceDue : row.amountDue,
    monthlyRent,
    workflowStatus: row.status,
    rentClassification: row.rentClassification,
    paymentIntent: row.paymentIntent,
    paymentStatus: row.paymentStatus,
    reminderSent: row.reminderSent,
    reminderSmsSent: row.reminderSmsSent,
    reminderEmailSent: row.reminderEmailSent,
    leaseStatus: resident?.status ?? null,
    moveInDate: resident?.moveInDate ?? null,
    riskLevel: risk,
  }

  return {
    workflowRunId: row.id,
    residentId: row.residentId,
    residentName,
    residentShortName: formatShortName(row.residentName),
    residentInitials: formatInitials(row.residentName),
    residentPhone: resident?.phone?.trim() || null,
    leaseStatusLabel: resolveLeaseStatusLabel(resident?.status),
    riskLabel: riskBadge.label,
    riskClassName: riskBadge.className,
    locationLabel,
    communicationPrefLabel: 'Prefers Both',
    nextReminderLabel: buildNextReminderLabel(row),
    balanceDueLabel: formatCurrency(balanceDue > 0 ? balanceDue : row.amountDue),
    daysOverdue,
    daysOverdueLabel: String(daysOverdue),
    monthlyRentLabel: formatCurrency(monthlyRent),
    paymentPlanSmsSent: row.paymentPlanSmsSent,
    lateFeeWaiverSmsSent: row.lateFeeWaiverSmsSent,
    insights: [
      buildOnTimeHistoryInsight(row, resident),
      buildEngagementInsight(row),
      buildIntentInsight(row),
      buildRiskInsight(row, risk, daysOverdue),
    ],
    insightsAccount,
  }
}

const LATE_RENT_ACTION_EVENT: Record<LateRentAccountAction, string> = {
  offer_payment_plan: 'rent.payment_plan_offered',
  waive_late_fee: 'rent.late_fee_waived',
  mark_payment_received: 'rent.payment_received',
}

const LATE_RENT_ACTION_MESSAGE: Record<LateRentAccountAction, string> = {
  offer_payment_plan: 'Payment plan offered by admin',
  waive_late_fee: 'Late fee waived by admin',
  mark_payment_received: 'Payment marked received by admin',
}

/**
 * Complete open rent_collection runs for this tenant so the escalation leaves
 * Awaiting Your Decision (queue is driven by workflow_runs.status, not balance alone).
 */
async function completeRentCollectionRunsAfterPayment(
  landlordId: string,
  review: LateRentAccountReview,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' }

  if (review.residentId) {
    const { error: balanceError } = await supabase
      .from('users')
      .update({ balance_due: 0 })
      .eq('id', review.residentId)
      .eq('landlord_id', landlordId)
    if (balanceError) {
      return { ok: false, error: balanceError.message }
    }
  }

  const now = new Date().toISOString()
  const runIds = new Set<string>([review.workflowRunId])

  if (review.residentId) {
    const { data: openRuns, error: runsError } = await supabase
      .from('workflow_runs')
      .select('id')
      .eq('landlord_id', landlordId)
      .eq('resident_id', review.residentId)
      .eq('template_id', 'rent_collection')
      .in('status', ['active', 'escalated'])

    if (runsError) return { ok: false, error: runsError.message }
    for (const row of openRuns ?? []) {
      if (typeof row.id === 'string' && row.id) runIds.add(row.id)
    }
  }

  for (const runId of runIds) {
    const { data: run, error: fetchError } = await supabase
      .from('workflow_runs')
      .select('id, status, metadata')
      .eq('id', runId)
      .eq('landlord_id', landlordId)
      .eq('template_id', 'rent_collection')
      .maybeSingle()

    if (fetchError) return { ok: false, error: fetchError.message }
    if (!run) {
      if (runId === review.workflowRunId) {
        return { ok: false, error: 'Workflow run not found.' }
      }
      continue
    }
    if (run.status === 'completed') continue

    const metadata =
      run.metadata && typeof run.metadata === 'object' && !Array.isArray(run.metadata)
        ? (run.metadata as Record<string, unknown>)
        : {}
    const stepState =
      metadata.step_state &&
      typeof metadata.step_state === 'object' &&
      !Array.isArray(metadata.step_state)
        ? (metadata.step_state as Record<string, unknown>)
        : {}

    const { error: updateError } = await supabase
      .from('workflow_runs')
      .update({
        status: 'completed',
        current_step: 'completed',
        current_stage: 'completed',
        completed_at: now,
        metadata: {
          ...metadata,
          amount_due: 0,
          payment_intent: 'paid',
          rent_classification: 'paid',
          admin_payment_received_at: now,
          escalated_at: null,
          escalation_reason: null,
          step_state: {
            ...stepState,
            step: 'completed',
            amount_due: 0,
            payment_intent: 'paid',
            rent_classification: 'paid',
          },
        },
      })
      .eq('id', runId)
      .eq('landlord_id', landlordId)

    if (updateError) return { ok: false, error: updateError.message }

    const { error: eventError } = await supabase.from('workflow_events').insert({
      workflow_run_id: runId,
      event_type: 'workflow.act',
      step: 'payment_received',
      actor_type: 'landlord',
      message: 'Admin marked rent payment received — escalation closed',
      metadata: {
        payment_intent: 'paid',
        rent_classification: 'paid',
        source: 'dashboard',
      },
    })
    if (eventError) return { ok: false, error: eventError.message }
  }

  return { ok: true }
}

export async function applyLateRentAccountAction(
  action: LateRentAccountAction,
  review: LateRentAccountReview,
  landlordId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' }

  if (action === 'mark_payment_received') {
    const completed = await completeRentCollectionRunsAfterPayment(landlordId, review)
    if (!completed.ok) return completed
  }

  const { error: graphError } = await supabase.from('operations_graph_events').insert({
    landlord_id: landlordId,
    event_type: LATE_RENT_ACTION_EVENT[action],
    source: 'dashboard',
    actor_type: 'landlord',
    workflow_run_id: review.workflowRunId,
    workflow_template_id: 'rent_collection',
    resident_id: review.residentId,
    metadata: {
      action,
      resident_name: review.residentName,
      message: LATE_RENT_ACTION_MESSAGE[action],
    },
  })

  if (graphError) {
    return { ok: false, error: graphError.message }
  }

  return { ok: true }
}
