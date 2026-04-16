/** Which step is in progress (1 = Under Review … 4 = Completed). `'resolved'` = all steps done. */
export type TicketTimelinePhase = 1 | 2 | 3 | 4 | 'resolved'

export const TICKET_TIMELINE_STEPS = [
  { title: 'Request Submitted', defaultSub: 'Just now' },
  { title: 'Under Review', defaultSub: 'Within 2 hours' },
  { title: 'Assigned to Technician', defaultSub: 'Pending' },
  { title: 'Work in Progress', defaultSub: 'Pending' },
  { title: 'Completed', defaultSub: 'Pending' },
] as const

/**
 * Maps your API `status` / `phase` string to a timeline phase.
 * Returns `null` if unknown (caller should keep the previous phase).
 */
export function mapRawStatusToTimelinePhase(raw: string): TicketTimelinePhase | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_')

  switch (s) {
    case 'submitted':
    case 'received':
    case 'under_review':
    case 'review':
    case 'new':
    case 'open':
    case 'triaging':
    case 'triage':
      return 1

    case 'scheduled':
    case 'assigned':
    case 'technician_assigned':
    case 'vendor_assigned':
      return 2

    case 'in_progress':
    case 'inprogress':
    case 'work_in_progress':
    case 'working':
      return 3

    case 'pending_signoff':
    case 'awaiting_confirmation':
    case 'final_review':
      return 4

    case 'resolved':
    case 'completed':
    case 'closed':
    case 'done':
      return 'resolved'

    default:
      return null
  }
}

export function stepIsDone(
  index: number,
  phase: TicketTimelinePhase,
): boolean {
  if (phase === 'resolved') return true
  return index < phase
}

export function stepIsActive(
  index: number,
  phase: TicketTimelinePhase,
): boolean {
  return typeof phase === 'number' && index === phase
}
