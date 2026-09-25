/**
 * Property Insights → inspector day scheduling (pure helpers).
 * Edge / client orchestrate DB + SMS; this module owns free-day rules,
 * hold claim semantics, card state transitions, and action routing gates.
 *
 * Canonical twin: shared/portfolioIntelligence/insightInspectorScheduling.ts
 * (vendored here so Supabase function Docker bundling resolves inside functions/).
 */

import type {
  InsightRecommendationActionType,
  InsightSchedulingCardState,
  InsightSchedulingScope,
  InsightSchedulingStatus,
} from './types.ts'

/** Default soft-offer timeout before falling through to external. */
export const INSPECTOR_PROBE_TIMEOUT_MS = 30 * 60 * 1000

export const INSPECTION_TRADE_SLUG = 'inspection' as const

export const INSIGHT_SCHEDULING_ACTION_TYPES = [
  'schedule_inspection',
  'schedule_building_inspection',
  'schedule_unit_walkthrough',
  'request_diagnostic',
] as const satisfies readonly InsightRecommendationActionType[]

export type InsightSchedulingActionType =
  (typeof INSIGHT_SCHEDULING_ACTION_TYPES)[number]

/** Actions that start the inspector soft-offer / external flow. */
export function entersInspectorSchedulingFlow(
  actionType: InsightRecommendationActionType,
): actionType is InsightSchedulingActionType {
  return (INSIGHT_SCHEDULING_ACTION_TYPES as readonly string[]).includes(actionType)
}

export function isFlagForReviewAction(
  actionType: InsightRecommendationActionType,
): boolean {
  return actionType === 'flag_for_review'
}

export function schedulingScopeForAction(
  actionType: InsightRecommendationActionType,
): InsightSchedulingScope | null {
  switch (actionType) {
    case 'schedule_building_inspection':
      return 'building'
    case 'schedule_unit_walkthrough':
    case 'schedule_inspection':
      return 'unit'
    case 'request_diagnostic':
      return 'diagnostic'
    default:
      return null
  }
}

/** YYYY-MM-DD for the next calendar day in a given IANA timezone (default local). */
export function defaultInsightTargetDay(
  now: Date = new Date(),
  timeZone?: string,
): string {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  if (!timeZone) {
    const y = tomorrow.getFullYear()
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0')
    const d = String(tomorrow.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(tomorrow)
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const m = parts.find((p) => p.type === 'month')?.value ?? '01'
  const d = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${y}-${m}-${d}`
}

export function formatInsightTargetDayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim())
  if (!m) return day
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export type InspectorBusyTicket = {
  assignedVendorId: string | null
  scheduledAt?: string | null
  scheduleConfirmedAt?: string | null
  vendorWorkStatus?: string | null
}

export type InspectorCandidate = {
  vendorId: string
  name: string
  phone?: string | null
  category?: string | null
  matchable: boolean
  /** US state service area when known. */
  serviceState?: string | null
}

export type InspectorDayHold = {
  vendorId: string
  holdDate: string
  status: 'held' | 'released' | 'consumed'
  expiresAt?: string | null
}

/** True when a ticket occupies the inspector on the given YYYY-MM-DD. */
export function ticketOccupiesInspectorDay(
  ticket: InspectorBusyTicket,
  day: string,
  vendorId: string,
): boolean {
  if ((ticket.assignedVendorId ?? '').trim() !== vendorId) return false
  const status = (ticket.vendorWorkStatus ?? '').trim().toLowerCase()
  if (status === 'cancelled' || status === 'declined') return false

  const dayKey = day.trim()
  for (const raw of [ticket.scheduledAt, ticket.scheduleConfirmedAt]) {
    if (!raw?.trim()) continue
    const iso = raw.trim()
    // Compare calendar day in UTC date prefix — scheduled_at is timestamptz ISO.
    if (iso.slice(0, 10) === dayKey) return true
  }
  return false
}

export function activeHoldBlocksInspector(
  holds: InspectorDayHold[],
  vendorId: string,
  day: string,
  nowMs: number = Date.now(),
): boolean {
  return holds.some((h) => {
    if (h.vendorId !== vendorId) return false
    if (h.holdDate !== day) return false
    if (h.status !== 'held') return false
    if (h.expiresAt) {
      const exp = Date.parse(h.expiresAt)
      if (Number.isFinite(exp) && exp <= nowMs) return false
    }
    return true
  })
}

/**
 * Free inspectors for a target day: matchable inspection-trade vendors
 * not busy on tickets and not under an active provisional hold.
 */
export function listFreeInspectorsForDay(input: {
  candidates: InspectorCandidate[]
  busyTickets: InspectorBusyTicket[]
  holds: InspectorDayHold[]
  day: string
  propertyState?: string | null
  nowMs?: number
}): InspectorCandidate[] {
  const day = input.day.trim()
  const nowMs = input.nowMs ?? Date.now()
  const state = (input.propertyState ?? '').trim().toUpperCase()

  return input.candidates.filter((c) => {
    if (!c.matchable) return false
    const category = (c.category ?? '').trim().toLowerCase()
    if (category !== INSPECTION_TRADE_SLUG) return false
    if (state) {
      const svc = (c.serviceState ?? '').trim().toUpperCase()
      if (svc && svc !== state) return false
    }
    if (activeHoldBlocksInspector(input.holds, c.vendorId, day, nowMs)) {
      return false
    }
    for (const ticket of input.busyTickets) {
      if (ticketOccupiesInspectorDay(ticket, day, c.vendorId)) return false
    }
    return true
  })
}

export type HoldClaimAttempt = {
  vendorId: string
  day: string
  /** Simulated unique index: true if another held row already exists. */
  alreadyHeld: boolean
}

/**
 * Claim semantics for concurrent same-day CTAs.
 * First claimer wins; second sees alreadyHeld and must go external.
 */
export function resolveHoldClaim(
  attempt: HoldClaimAttempt,
): { claimed: true; vendorId: string; day: string } | { claimed: false; reason: 'already_held' } {
  if (attempt.alreadyHeld) return { claimed: false, reason: 'already_held' }
  return { claimed: true, vendorId: attempt.vendorId, day: attempt.day }
}

export function idleInsightSchedulingState(): InsightSchedulingCardState {
  return {
    status: 'idle',
    ticketId: null,
    targetDay: null,
    inspectorName: null,
    confirmedWindow: null,
    holdId: null,
    requestId: null,
  }
}

/** Start probing — never reveal inspector name yet. */
export function toProbingState(input: {
  ticketId: string
  targetDay: string
  holdId: string
  requestId: string
}): InsightSchedulingCardState {
  return {
    status: 'probing',
    ticketId: input.ticketId,
    targetDay: input.targetDay,
    inspectorName: null,
    confirmedWindow: null,
    holdId: input.holdId,
    requestId: input.requestId,
  }
}

export function toNeedsExternalState(input: {
  ticketId: string | null
  targetDay: string
  requestId?: string | null
}): InsightSchedulingCardState {
  return {
    status: 'needs_external',
    ticketId: input.ticketId,
    targetDay: input.targetDay,
    inspectorName: null,
    confirmedWindow: null,
    holdId: null,
    requestId: input.requestId ?? null,
  }
}

/** Reveal name only after accept. */
export function toAcceptedState(input: {
  ticketId: string
  targetDay: string
  inspectorName: string
  confirmedWindow: string | null
  requestId?: string | null
}): InsightSchedulingCardState {
  return {
    status: 'accepted',
    ticketId: input.ticketId,
    targetDay: input.targetDay,
    inspectorName: input.inspectorName,
    confirmedWindow: input.confirmedWindow,
    holdId: null,
    requestId: input.requestId ?? null,
  }
}

export function probingStatusLabel(): string {
  return 'Reaching out to an available inspector'
}

export function needsExternalStatusLabel(targetDay: string): string {
  return `No inspector available for ${formatInsightTargetDayLabel(targetDay)} — find an external vendor?`
}

export function acceptedStatusLabel(state: InsightSchedulingCardState): string {
  const name = state.inspectorName?.trim() || 'Inspector'
  const window = state.confirmedWindow?.trim()
  return window ? `${name} · ${window}` : name
}

export function isProbeTimedOut(input: {
  startedAt: string
  nowMs?: number
  timeoutMs?: number
}): boolean {
  const started = Date.parse(input.startedAt)
  if (!Number.isFinite(started)) return false
  const timeout = input.timeoutMs ?? INSPECTOR_PROBE_TIMEOUT_MS
  return (input.nowMs ?? Date.now()) - started >= timeout
}

/**
 * Pure decision for a scheduling CTA given free inspectors + hold claim result.
 * Does not perform I/O — Edge applies the outcome.
 */
export function decideInsightInspectorScheduling(input: {
  freeInspectors: InspectorCandidate[]
  /** Result of attempting to claim the first free inspector's day hold. */
  holdClaim:
    | { claimed: true; vendorId: string; day: string; holdId: string }
    | { claimed: false; reason: 'already_held' | 'none_free' }
  ticketId: string
  targetDay: string
  requestId: string
}):
  | {
      outcome: 'probe'
      vendorId: string
      holdId: string
      card: InsightSchedulingCardState
    }
  | {
      outcome: 'needs_external'
      card: InsightSchedulingCardState
      reason: 'none_free' | 'hold_conflict'
    } {
  if (input.freeInspectors.length === 0 || input.holdClaim.claimed === false) {
    return {
      outcome: 'needs_external',
      reason:
        input.holdClaim.claimed === false && input.holdClaim.reason === 'already_held'
          ? 'hold_conflict'
          : 'none_free',
      card: toNeedsExternalState({
        ticketId: input.ticketId,
        targetDay: input.targetDay,
        requestId: input.requestId,
      }),
    }
  }

  return {
    outcome: 'probe',
    vendorId: input.holdClaim.vendorId,
    holdId: input.holdClaim.holdId,
    card: toProbingState({
      ticketId: input.ticketId,
      targetDay: input.targetDay,
      holdId: input.holdClaim.holdId,
      requestId: input.requestId,
    }),
  }
}

export function applyInspectorProbeDeclineOrTimeout(input: {
  ticketId: string
  targetDay: string
  requestId?: string | null
}): InsightSchedulingCardState {
  return toNeedsExternalState(input)
}

export function applyInspectorProbeAccept(input: {
  ticketId: string
  targetDay: string
  inspectorName: string
  confirmedWindow: string | null
  requestId?: string | null
}): InsightSchedulingCardState {
  return toAcceptedState(input)
}

/** Vendor performance / review destination (never scheduling). */
export function flagForReviewHref(input: {
  assignedVendorId?: string | null
}): string {
  const id = input.assignedVendorId?.trim()
  if (id) return `/admin/vendors/${encodeURIComponent(id)}`
  return '/admin/vendors'
}

export function cardStatusFromDb(
  status: string | null | undefined,
): InsightSchedulingStatus {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'probing':
      return 'probing'
    case 'accepted':
      return 'accepted'
    case 'needs_external':
      return 'needs_external'
    default:
      return 'idle'
  }
}
