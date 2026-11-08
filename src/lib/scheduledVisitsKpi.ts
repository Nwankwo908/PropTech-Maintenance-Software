/** Confirmed visit still ahead on an open work order. */

export type ScheduledVisitTicket = {
  scheduledAt: string | null
  scheduleConfirmedAt: string | null
  vendorWorkStatus: string
}

const NOT_AN_UPCOMING_VISIT = new Set(['cancelled', 'declined', 'completed'])

function startOfLocalDay(nowMs: number): number {
  const start = new Date(nowMs)
  start.setHours(0, 0, 0, 0)
  return start.getTime()
}

function confirmedInstant(ticket: ScheduledVisitTicket): number | null {
  if (!ticket.scheduleConfirmedAt?.trim()) return null
  const instant = ticket.scheduledAt?.trim()
  if (!instant) return null
  const at = new Date(instant).getTime()
  return Number.isNaN(at) ? null : at
}

/** Resident-confirmed visit today or later, still on an open work order. */
export function isConfirmedUpcomingVisit(
  ticket: ScheduledVisitTicket,
  nowMs: number = Date.now(),
): boolean {
  const at = confirmedInstant(ticket)
  if (at == null) return false
  const status = ticket.vendorWorkStatus.trim().toLowerCase()
  if (NOT_AN_UPCOMING_VISIT.has(status)) return false
  return at >= startOfLocalDay(nowMs)
}

/** Resident-confirmed visit whose window falls on the local calendar day. */
export function isConfirmedVisitToday(
  ticket: ScheduledVisitTicket,
  nowMs: number = Date.now(),
): boolean {
  const at = confirmedInstant(ticket)
  if (at == null) return false
  const status = ticket.vendorWorkStatus.trim().toLowerCase()
  if (NOT_AN_UPCOMING_VISIT.has(status)) return false
  const dayStart = startOfLocalDay(nowMs)
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  return at >= dayStart && at < dayEnd
}