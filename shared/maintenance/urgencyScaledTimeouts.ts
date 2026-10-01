/**
 * Urgency-scaled automation timeouts using the same URGENCY_SLA_MINUTES
 * constants as intake silence / ticket due_at.
 *
 * Confirmed audit scaling (do not expand without product review):
 * - Landlord choice dwell → emergencyLifeSafety (1h) when urgent
 * - Vendor probe dwell → emergencyWater (2h) when urgent
 * - Schedule FSM tenant confirm → 60m / 120m when urgent
 * - Vendor availability ask → stay flat (~24h); do not compress
 *
 * Left flat on purpose: pending_accept rematch/stall, estimate landlord-notify.
 */

import { URGENCY_SLA_MINUTES } from './urgencyPolicy.ts'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

/** Routine defaults (same as pre-scaling flat constants). */
export const ROUTINE_LANDLORD_CHOICE_DWELL_MS = 48 * HOUR_MS
export const ROUTINE_PROBE_DWELL_MS = 48 * HOUR_MS
export const ROUTINE_SCHEDULE_TTL_MS = 24 * HOUR_MS

export type TicketUrgencySnapshot = {
  urgency?: string | null
  severity?: string | null
  dueAt?: string | null
  createdAt?: string | null
}

export function slaWindowMinutesFromDueAt(
  createdAt?: string | null,
  dueAt?: string | null,
): number | null {
  const created = createdAt ? Date.parse(String(createdAt).trim()) : NaN
  const due = dueAt ? Date.parse(String(dueAt).trim()) : NaN
  if (!Number.isFinite(created) || !Number.isFinite(due) || due < created) {
    return null
  }
  return Math.round((due - created) / MINUTE_MS)
}

/**
 * True when the ticket is already in an emergency/habitability band —
 * from persisted urgency/severity or a due_at window at/under same-day SLA.
 */
export function isUrgentTicket(snap: TicketUrgencySnapshot): boolean {
  const u = String(snap.urgency ?? '')
    .trim()
    .toLowerCase()
  if (u === 'emergency' || u === 'urgent') return true

  const s = String(snap.severity ?? '')
    .trim()
    .toLowerCase()
  if (
    s === 'critical' ||
    s === 'urgent' ||
    s === 'emergency' ||
    s === 'high'
  ) {
    return true
  }

  const mins = slaWindowMinutesFromDueAt(snap.createdAt, snap.dueAt)
  return mins != null && mins <= URGENCY_SLA_MINUTES.emergencySameDay
}

/** Life-safety band (gas/fire/electrical) — tightest SLA on the ticket. */
export function isLifeSafetyTicket(snap: TicketUrgencySnapshot): boolean {
  const s = String(snap.severity ?? '')
    .trim()
    .toLowerCase()
  if (s === 'critical') return true
  const mins = slaWindowMinutesFromDueAt(snap.createdAt, snap.dueAt)
  return mins != null && mins <= URGENCY_SLA_MINUTES.emergencyLifeSafety
}

/** Landlord YES/1/2 choice: 1h urgent, 48h routine. */
export function landlordChoiceDwellMsForTicket(
  snap: TicketUrgencySnapshot,
  routineMs: number = ROUTINE_LANDLORD_CHOICE_DWELL_MS,
): number {
  if (!isUrgentTicket(snap)) return routineMs
  return URGENCY_SLA_MINUTES.emergencyLifeSafety * MINUTE_MS
}

/** Soft availability probe: 2h urgent, 48h routine. */
export function probeDwellMsForTicket(
  snap: TicketUrgencySnapshot,
  routineMs: number = ROUTINE_PROBE_DWELL_MS,
): number {
  if (!isUrgentTicket(snap)) return routineMs
  return URGENCY_SLA_MINUTES.emergencyWater * MINUTE_MS
}

/**
 * awaiting_tenant_confirmation expiry: life-safety 60m, other urgent 120m,
 * routine 24h. Does not apply to vendor earliest-availability ask.
 */
export function tenantConfirmTtlMsForTicket(
  snap: TicketUrgencySnapshot,
  routineMs: number = ROUTINE_SCHEDULE_TTL_MS,
): number {
  if (!isUrgentTicket(snap)) return routineMs
  if (isLifeSafetyTicket(snap)) {
    return URGENCY_SLA_MINUTES.emergencyLifeSafety * MINUTE_MS
  }
  return URGENCY_SLA_MINUTES.emergencyWater * MINUTE_MS
}

/**
 * Vendor "earliest availability?" ask — intentionally flat (audit).
 * Callers may pass emergencySameDay as a ceiling later; do not compress by default.
 */
export function vendorAvailabilityTtlMsForTicket(
  _snap: TicketUrgencySnapshot,
  routineMs: number = ROUTINE_SCHEDULE_TTL_MS,
): number {
  return routineMs
}
