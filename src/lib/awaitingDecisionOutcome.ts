import {
  type LateRentAccountAction,
  type LateRentAccountReview,
} from '@/lib/lateRentAccountReview'
import {
  type LeaseRenewalEscalatedAction,
  type LeaseRenewalEscalatedReview,
} from '@/lib/leaseRenewalEscalatedReview'

export type AwaitingDecisionOutcomeKind = 'resolved' | 'moved' | 'updated'

export type AwaitingDecisionOutcome = {
  operationTitle: string
  context: string
  kind: AwaitingDecisionOutcomeKind
  headline: string
  detail: string
  removedFromQueue: boolean
  actionLabel?: string
  actionTo?: string
}

export function buildLateRentActionOutcome(
  action: LateRentAccountAction,
  review: LateRentAccountReview,
): AwaitingDecisionOutcome {
  const operationTitle = 'Late Rent Escalation'
  const context = review.locationLabel

  // Only Mark payment received acknowledges / removes from the queue.
  // Offer payment plan and waive late fee are SMS follow-ups that stay open.
  if (action === 'mark_payment_received') {
    return {
      operationTitle,
      context,
      kind: 'resolved',
      headline: 'Removed from Awaiting Your Decision',
      detail: `Payment recorded for ${review.residentShortName}. Ulo cleared this late rent escalation and will resume standard rent collection if needed.`,
      removedFromQueue: true,
    }
  }

  return {
    operationTitle,
    context,
    kind: 'updated',
    headline: 'Action recorded',
    detail: `Update recorded for ${review.residentShortName}. This escalation stays in Awaiting Your Decision until payment is marked received.`,
    removedFromQueue: false,
  }
}

export function buildLeaseRenewalActionOutcome(
  action: LeaseRenewalEscalatedAction,
  review: LeaseRenewalEscalatedReview,
  options?: { moveOutRunId?: string | null },
): AwaitingDecisionOutcome {
  const operationTitle = review.headerTitle
  const context = review.locationLabel

  if (action === 'trigger_move_out_prep') {
    const moveOutRunId = options?.moveOutRunId?.trim()
    return {
      operationTitle,
      context,
      kind: 'moved',
      headline: 'Removed from Awaiting Your Decision',
      detail:
        'Move-out preparation is now active. Ulo completed the lease renewal escalation and started coordinating move-out instructions, inspection, and keys with the resident.',
      removedFromQueue: true,
      actionLabel: moveOutRunId ? 'View move-out in Active Tasks' : undefined,
      actionTo: moveOutRunId
        ? `/admin/workflows?run=${encodeURIComponent(moveOutRunId)}`
        : undefined,
    }
  }

  if (action === 'mark_resolved') {
    return {
      operationTitle,
      context,
      kind: 'resolved',
      headline: "You're all set.",
      detail: 'This item has been resolved and no longer needs your attention.',
      removedFromQueue: true,
    }
  }

  if (action === 'offer_renewal_incentive') {
    return {
      operationTitle,
      context,
      kind: 'updated',
      headline: 'Incentive message ready',
      detail:
        'Ulo drafted a renewal incentive SMS. Review the suggestion, edit if needed, and send it to the resident. This item remains in Awaiting Your Decision until resolved.',
      removedFromQueue: false,
    }
  }

  return {
    operationTitle,
    context,
    kind: 'updated',
    headline: 'Action recorded',
    detail: `Call initiated for ${review.locationLabel}. Follow up in the resident thread as needed.`,
    removedFromQueue: false,
  }
}

export function buildLeaseRenewalIncentiveSentOutcome(input: {
  locationLabel: string
  incentiveAmountLabel: string
  residentName: string
}): AwaitingDecisionOutcome {
  return {
    operationTitle: 'Lease Renewal Escalated',
    context: input.locationLabel,
    kind: 'updated',
    headline: 'Incentive offer sent',
    detail: `Ulo logged a ${input.incentiveAmountLabel} renewal incentive SMS draft for ${input.residentName}. Follow up in the resident thread as needed. This item remains in Awaiting Your Decision until resolved.`,
    removedFromQueue: false,
  }
}

export function buildVendorAssignedOutcome(input: {
  operationTitle: string
  context: string
  vendorName: string
  external?: boolean
}): AwaitingDecisionOutcome {
  return {
    operationTitle: input.operationTitle,
    context: input.context,
    kind: 'resolved',
    headline: 'Removed from Awaiting Your Decision',
    detail: input.external
      ? `${input.vendorName} was assigned as an external vendor. Ulo sent onboarding outreach and moved this work order back into the active pipeline.`
      : `${input.vendorName} was assigned. Ulo notified the vendor and moved this work order back into the active pipeline.`,
    removedFromQueue: true,
    actionLabel: 'View in Active Tasks',
    actionTo: '/admin/workflows',
  }
}

export function buildAutoRemovedAttentionOutcome(input: {
  title: string
  context: string
  meta?: string
}): AwaitingDecisionOutcome {
  return {
    operationTitle: input.title,
    context: input.context,
    kind: 'resolved',
    headline: 'No longer awaiting your decision',
    detail:
      input.meta?.trim()
        ? `${input.meta.trim()}. Ulo or another workflow update cleared this from your decision queue.`
        : 'Ulo or another workflow update cleared this from your decision queue.',
    removedFromQueue: true,
  }
}
