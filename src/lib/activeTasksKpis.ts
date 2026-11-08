import type { WorkflowKanbanCard, WorkflowKanbanStageId } from '@/lib/adminWorkflowKanban'
import { isSlaOverdueOpenTicket } from '@/lib/slaOverdueActionReview'
import { isConfirmedVisitToday } from '@/lib/scheduledVisitsKpi'

export type ActiveTasksKpiBucket =
  | 'needs_attention'
  | 'waiting_on_others'
  | 'scheduled_today'
  | 'overdue'

export type ActiveTasksKpis = {
  needsYourAttention: number
  waitingOnOthers: number
  scheduledToday: number
  overdue: number
  /** Run ids in each bucket (mutually exclusive; priority listed above). */
  runIdsByBucket: Record<ActiveTasksKpiBucket, string[]>
}

export type ActiveTasksKpiCard = Pick<
  WorkflowKanbanCard,
  'id' | 'stage' | 'critical' | 'ticketId'
> & {
  dueAt?: string | null
  scheduledAt?: string | null
  scheduleConfirmedAt?: string | null
  vendorWorkStatus?: string | null
}

const CLOSED_STAGES = new Set<WorkflowKanbanStageId>(['completed'])

function isOpenCard(card: ActiveTasksKpiCard): boolean {
  return !CLOSED_STAGES.has(card.stage)
}

function isOverdueCard(card: ActiveTasksKpiCard, nowMs: number): boolean {
  const dueAt = card.dueAt?.trim() || null
  if (!dueAt) return false
  const dueTs = new Date(dueAt).getTime()
  if (Number.isNaN(dueTs) || dueTs >= nowMs) return false

  // Response-time breach while still waiting on a vendor.
  if (
    isSlaOverdueOpenTicket({
      dueAt,
      vendorWorkStatus: card.vendorWorkStatus ?? '',
    })
  ) {
    return true
  }

  // Past due on an open work order that already has a vendor moving.
  const status = (card.vendorWorkStatus ?? '').trim().toLowerCase()
  if (status === 'cancelled' || status === 'completed' || status === 'declined') {
    return false
  }
  return true
}

function isScheduledTodayCard(card: ActiveTasksKpiCard, nowMs: number): boolean {
  return isConfirmedVisitToday(
    {
      scheduledAt: card.scheduledAt ?? null,
      scheduleConfirmedAt: card.scheduleConfirmedAt ?? null,
      vendorWorkStatus: card.vendorWorkStatus ?? '',
    },
    nowMs,
  )
}

/**
 * Classify one Active Tasks card into a KPI bucket.
 * Priority: needs attention → overdue → scheduled today → waiting on others.
 */
export function classifyActiveTasksKpiBucket(
  card: ActiveTasksKpiCard,
  nowMs: number = Date.now(),
): ActiveTasksKpiBucket | null {
  if (!isOpenCard(card)) return null
  if (card.critical) return 'needs_attention'
  if (isOverdueCard(card, nowMs)) return 'overdue'
  if (isScheduledTodayCard(card, nowMs)) return 'scheduled_today'
  return 'waiting_on_others'
}

export function computeActiveTasksKpis(
  cards: ActiveTasksKpiCard[],
  nowMs: number = Date.now(),
): ActiveTasksKpis {
  const runIdsByBucket: Record<ActiveTasksKpiBucket, string[]> = {
    needs_attention: [],
    waiting_on_others: [],
    scheduled_today: [],
    overdue: [],
  }

  for (const card of cards) {
    const bucket = classifyActiveTasksKpiBucket(card, nowMs)
    if (!bucket) continue
    runIdsByBucket[bucket].push(card.id)
  }

  return {
    needsYourAttention: runIdsByBucket.needs_attention.length,
    waitingOnOthers: runIdsByBucket.waiting_on_others.length,
    scheduledToday: runIdsByBucket.scheduled_today.length,
    overdue: runIdsByBucket.overdue.length,
    runIdsByBucket,
  }
}
