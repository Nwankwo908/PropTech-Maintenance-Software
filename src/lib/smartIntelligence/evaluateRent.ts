import { workflowOperationsPath } from '@/lib/adminWorkflowKanban'
import type { AdminRentCollectionRow } from '@/lib/adminWorkflows'
import {
  calendarDaysUntil,
  formatUsd,
  nextRentDueIso,
  possessive,
  scoreInsight,
} from '@/lib/smartIntelligence/helpers'
import type { SmartInsight, SmartIntelligenceContext } from '@/lib/smartIntelligence/types'

function activeRentRun(ctx: SmartIntelligenceContext): AdminRentCollectionRow | null {
  const runs = ctx.workflowData?.rentCollection.runs ?? []
  const open = runs.filter(
    (run) =>
      run.status !== 'completed' &&
      run.status !== 'cancelled' &&
      run.rentClassification !== 'paid' &&
      run.paymentStatus !== 'Paid',
  )
  return open[0] ?? null
}

export function evaluateRentIntelligence(ctx: SmartIntelligenceContext): SmartInsight[] {
  const now = ctx.now ?? new Date()
  const { resident } = ctx
  const run = activeRentRun(ctx)
  const paid =
    run == null &&
    (ctx.workflowData?.rentCollection.runs ?? []).some(
      (row) => row.rentClassification === 'paid' || row.paymentStatus === 'Paid',
    )
  const nextDue =
    run?.rentDueDate ??
    nextRentDueIso({
      now,
      rentDueDay: resident.rentDueDay,
      leaseStartDate: resident.leaseStartDate,
      leaseEndDate: resident.leaseEndDate,
    })
  const daysUntil = nextDue ? calendarDaysUntil(nextDue, now) : null
  const periodAmount =
    (run?.amountDue && run.amountDue > 0 ? run.amountDue : null) ??
    (resident.monthlyRent && resident.monthlyRent > 0 ? resident.monthlyRent : null)
  const balance = resident.balanceDue > 0.5 ? resident.balanceDue : 0
  const overdue = Boolean(run?.isOverdue) || (daysUntil != null && daysUntil < 0)
  const dueToday = Boolean(run?.isDueToday) || daysUntil === 0
  const dueSoon = daysUntil != null && daysUntil > 0 && daysUntil <= 5
  const partial = run?.rentClassification === 'partial_payment' || run?.paymentStatus === 'Partial'
  const confirmNeeded = Boolean(run) && (overdue || dueToday || partial)
  const whose = possessive(resident.name)
  const rentRoute = workflowOperationsPath(run?.id)
  const leaseRoute = '#resident-lease'

  if (paid && balance <= 0 && !overdue && !dueToday && !dueSoon) return []

  const insights: SmartInsight[] = []

  if (!paid && (overdue || dueToday) && periodAmount && periodAmount > 0) {
    const extra = balance > periodAmount + 0.5 ? balance - periodAmount : balance > 0 && Math.abs(balance - periodAmount) > 0.5 ? balance : 0
    const total = extra > 0 && balance > periodAmount ? balance : extra > 0 ? periodAmount + extra : periodAmount
    const waiting = confirmNeeded || dueToday || overdue
    if (extra > 0 && waiting) {
      insights.push({
        id: `rent-combined-${resident.id}`,
        type: 'rent',
        priority: overdue ? 'urgent' : 'attention',
        title: `${formatUsd(total)} needs payment confirmation`,
        description: dueToday
          ? `Today's ${formatUsd(periodAmount)} rent plus a ${formatUsd(extra)} existing balance is still awaiting confirmation.`
          : `${whose} ${formatUsd(periodAmount)} rent is overdue, plus a ${formatUsd(extra)} remaining balance.`,
        action: { label: 'Confirm Payment', route: rentRoute },
        dueAt: nextDue ?? undefined,
        amount: total,
        entityId: run?.id ?? resident.id,
        score: scoreInsight(overdue ? 'urgent' : 'attention', {
          overdueDays: overdue && daysUntil != null ? Math.abs(daysUntil) : 0,
          amount: total,
          waitingOnLandlord: true,
        }),
      })
      return insights
    }

    if (overdue && daysUntil != null) {
      insights.push({
        id: `rent-overdue-${resident.id}`,
        type: 'rent',
        priority: Math.abs(daysUntil) >= 2 || total >= 500 ? 'urgent' : 'attention',
        title:
          daysUntil === -1
            ? 'Rent is 1 day overdue'
            : `Rent is ${Math.abs(daysUntil)} days overdue`,
        description: `${formatUsd(periodAmount)} remains unpaid.`,
        action: { label: 'Confirm Payment', route: rentRoute },
        dueAt: nextDue ?? undefined,
        amount: periodAmount,
        entityId: run?.id ?? resident.id,
        score: scoreInsight(Math.abs(daysUntil) >= 2 || total >= 500 ? 'urgent' : 'attention', {
          overdueDays: Math.abs(daysUntil),
          amount: periodAmount,
          waitingOnLandlord: true,
        }),
      })
    } else if (dueToday) {
      insights.push({
        id: `rent-due-today-${resident.id}`,
        type: 'rent',
        priority: 'attention',
        title: 'Rent payment needs confirmation',
        description: `Rent was due today. Confirm whether ${formatUsd(periodAmount)} was received.`,
        action: { label: 'Confirm Payment', route: rentRoute },
        dueAt: nextDue ?? undefined,
        amount: periodAmount,
        entityId: run?.id ?? resident.id,
        score: scoreInsight('attention', { amount: periodAmount, waitingOnLandlord: true, daysUntil: 0 }),
      })
    }
  } else if (!paid && dueSoon && periodAmount && periodAmount > 0 && daysUntil != null) {
    insights.push({
      id: `rent-due-soon-${resident.id}`,
      type: 'rent',
      priority: 'upcoming',
      title: 'Rent due soon',
      description: `${whose} ${formatUsd(periodAmount)} rent is due in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}.`,
      action: { label: 'View Rent', route: run?.id ? rentRoute : leaseRoute },
      dueAt: nextDue ?? undefined,
      amount: periodAmount,
      entityId: run?.id ?? resident.id,
      score: scoreInsight('upcoming', { amount: periodAmount, daysUntil }),
    })
  }

  if (balance > 0 && !insights.some((item) => item.id.startsWith('rent-combined'))) {
    const significant = balance >= 400
    insights.push({
      id: `rent-balance-${resident.id}`,
      type: 'rent',
      priority: significant ? 'urgent' : 'attention',
      title: 'Outstanding balance',
      description: `${firstWord(resident.name)} has a remaining balance of ${formatUsd(balance)}.`,
      action: { label: 'Review Balance', route: leaseRoute },
      amount: balance,
      entityId: resident.id,
      score: scoreInsight(significant ? 'urgent' : 'attention', { amount: balance }),
    })
  }

  return insights
}

function firstWord(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean)[0] || 'This resident'
}
