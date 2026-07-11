import type { LeaseRenewalEscalatedReview } from '@/lib/leaseRenewalEscalatedReview'

export type LeaseRenewalIncentiveChatMessage = {
  id: string
  sender: 'ulo' | 'landlord' | 'resident'
  body: string
  timeLabel: string
  aiLabel?: string
}

export type LeaseRenewalIncentiveBrief = {
  workflowRunId: string
  residentName: string
  residentInitials: string
  locationLabel: string
  incentiveAmountLabel: string
  daysUntilLeaseEndLabel: string
  summary: string
  messages: LeaseRenewalIncentiveChatMessage[]
  /** AI-recommended SMS drafts shown under “Ulo suggestion”. */
  uloSuggestions: string[]
}

const DEFAULT_INCENTIVE_AMOUNT = 100

function firstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  return parts[0] || 'there'
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase()
}

/** Build the messaging brief opened after “Offer renewal incentive”. */
export function buildLeaseRenewalIncentiveBrief(
  review: LeaseRenewalEscalatedReview,
  options?: { residentName?: string | null; incentiveAmount?: number },
): LeaseRenewalIncentiveBrief {
  const amount = options?.incentiveAmount ?? DEFAULT_INCENTIVE_AMOUNT
  const incentiveAmountLabel = `$${amount}`
  const residentName = options?.residentName?.trim() || 'Resident'
  const fname = firstName(residentName)
  const days = review.daysUntilLeaseEndLabel

  const primaryDraft =
    `Hi ${fname} — we'd love for you to renew. We're offering a ${incentiveAmountLabel} rent credit if you sign your renewal in the next 7 days. Reply YES and I'll send the renewal details, or tell me what would make staying work better.`

  const alternateDraft =
    `Hi ${fname}, checking in on your lease (ends in ${days}). To make renewing easier, we can apply a ${incentiveAmountLabel} credit to your next month's rent when you renew. Want me to hold that offer for you?`

  return {
    workflowRunId: review.workflowRunId,
    residentName,
    residentInitials: initialsFromName(residentName),
    locationLabel: review.locationLabel,
    incentiveAmountLabel,
    daysUntilLeaseEndLabel: days,
    summary: `Ulo drafted a ${incentiveAmountLabel} renewal incentive for ${residentName} at ${review.locationLabel}. Review the suggestion, edit if needed, then send over SMS.`,
    messages: [],
    uloSuggestions: [primaryDraft, alternateDraft],
  }
}

export async function sendLeaseRenewalIncentiveMessage(
  brief: LeaseRenewalIncentiveBrief,
  message: string,
  landlordId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase } = await import('@/lib/supabase')
  if (!supabase) return { ok: false, error: 'Supabase is not configured.' }

  const trimmed = message.trim()
  if (!trimmed) return { ok: false, error: 'Message is empty.' }

  const { error } = await supabase.from('operations_graph_events').insert({
    landlord_id: landlordId,
    event_type: 'lease.renewal_incentive_sms_drafted',
    source: 'dashboard',
    actor_type: 'landlord',
    workflow_run_id: brief.workflowRunId,
    workflow_template_id: 'lease_renewal',
    metadata: {
      incentive_amount_label: brief.incentiveAmountLabel,
      message: trimmed,
      channel: 'sms',
      resident_name: brief.residentName,
      location_label: brief.locationLabel,
    },
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

function formatSentTimeLabel(now = new Date()): string {
  return now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Append an outbound landlord SMS to the incentive thread after send. */
export function appendLeaseRenewalIncentiveSentMessage(
  brief: LeaseRenewalIncentiveBrief,
  message: string,
  now = new Date(),
): LeaseRenewalIncentiveBrief {
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
