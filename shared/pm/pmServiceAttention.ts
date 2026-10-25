import { matchEmergencyNet } from '../maintenance/deterministicRules.ts'

/** Needs Your Attention kind for preventive HVAC. */
export const PM_SERVICE_ATTENTION_KIND = 'pm_service' as const

export type PmServiceAttentionSubtype =
  | 'batch_approval'
  | 'overdue'
  | 'vendor_unavailable'
  | 'tenant_unconfirmed'
  | 'service_finding'

export type PmServiceVisitPhase =
  | 'proposed'
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'declined'

/** Visits in these phases never become attention cards. */
const QUIET_PHASES = new Set<PmServiceVisitPhase>(['scheduled', 'confirmed', 'completed'])

export type PmServiceUnitSnapshot = {
  id: string
  planId: string
  unitLabel: string
  vendorName?: string | null
  cost?: number | null
  phase: PmServiceVisitPhase
  taskStatus?: 'scheduled' | 'assigned' | 'completed' | 'cancelled' | null
  windowStart?: string | null
  windowEnd?: string | null
  visitAt?: string | null
  vendorAskedAt?: string | null
  /** pending until the vendor answers; declined or available closes the ask. */
  vendorResponse?: 'pending' | 'declined' | 'available' | null
  tenantConfirmed?: boolean
  completionNotes?: string | null
  rescheduled?: boolean
}

export type PmServiceBatchSnapshot = {
  batchId: string
  propertyLabel: string
  units: PmServiceUnitSnapshot[]
  /** Set when the landlord already approved or declined this batch. */
  resolution?: 'app' | 'sms' | 'declined' | null
  snoozedUntil?: string | null
}

export type PmServiceCard = {
  key: string
  idempotencyKey: string
  subtype: PmServiceAttentionSubtype
  batchId: string
  title: string
  context: string
  meta: string
  badge: 'critical' | 'warning'
  /** Safety findings sort above other critical HVAC cards. */
  safety: boolean
  dueAt: string | null
  windowStart: string | null
  canSnooze: boolean
  units: Array<{
    id: string
    unitLabel: string
    vendorName: string | null
    visitLabel: string
    cost: number | null
  }>
  totalCost: number | null
}

export type RankedAttention = {
  id: string
  /** Emergency repairs stay ahead of every HVAC card in the top 3. */
  emergencyRepair?: boolean
  safety?: boolean
  badge: 'critical' | 'warning'
  dueAt?: string | null
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const VENDOR_WAIT_MS = 48 * HOUR_MS
const TENANT_CONFIRM_WINDOW_MS = 48 * HOUR_MS
const BATCH_CRITICAL_WINDOW_MS = 7 * DAY_MS
const SNOOZE_MS = 3 * DAY_MS

/** HVAC findings the emergency net does not phrase on its own. */
const HVAC_SAFETY_RE =
  /\b(cracked\s+heat\s+exchanger|scorched\s+wir(?:e|ing)|carbon\s+monoxide|\bco\b|gas\s+leak|smell(?:s|ed)?\s+(?:of\s+)?gas)\b/i

const FINDING_RE =
  /\b(issue|problem|repair\s+needed|recommend(?:ed)?\s+replacement|failed|failure|leak|damage|unsafe)\b/i

export function isYesHvacReply(body: string | null | undefined): boolean {
  return /^\s*yes\s+hvac\s*$/i.test(body ?? '')
}

export function isPmServiceSafetyFinding(text: string | null | undefined): boolean {
  const raw = (text ?? '').trim()
  if (!raw) return false
  if (matchEmergencyNet(raw)) return true
  return HVAC_SAFETY_RE.test(raw)
}

export function isPmServiceFinding(text: string | null | undefined): boolean {
  const raw = (text ?? '').trim()
  if (!raw) return false
  return isPmServiceSafetyFinding(raw) || FINDING_RE.test(raw)
}

export function pmServiceIdempotencyKey(
  subtype: PmServiceAttentionSubtype,
  ids: { batchId?: string | null; planId?: string | null; windowEnd?: string | null; visitAt?: string | null },
): string {
  if (subtype === 'batch_approval') return `pm_batch:${ids.batchId ?? ''}`
  if (subtype === 'overdue') return `pm_overdue:${ids.planId ?? ''}:${ids.windowEnd ?? ''}`
  if (subtype === 'vendor_unavailable') return `pm_vendor_unavailable:${ids.planId ?? ''}`
  if (subtype === 'tenant_unconfirmed') {
    return `pm_tenant_unconfirmed:${ids.planId ?? ''}:${ids.visitAt ?? ''}`
  }
  return `pm_finding:${ids.planId ?? ''}`
}

function time(value: string | null | undefined): number | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  const ms = new Date(raw).getTime()
  return Number.isFinite(ms) ? ms : null
}

function quietUnit(unit: PmServiceUnitSnapshot): boolean {
  if (QUIET_PHASES.has(unit.phase)) return true
  const status = unit.taskStatus ?? ''
  return status === 'completed' || status === 'cancelled'
}

function formatMoney(amount: number | null): string | null {
  if (amount == null || !Number.isFinite(amount)) return null
  return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function formatVisit(iso: string | null | undefined): string {
  const ms = time(iso)
  if (ms == null) return 'Date not set'
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function soonest(values: Array<string | null | undefined>): string | null {
  let best: string | null = null
  let bestMs = Number.POSITIVE_INFINITY
  for (const value of values) {
    const ms = time(value)
    if (ms == null || ms >= bestMs) continue
    bestMs = ms
    best = value ?? null
  }
  return best
}

function unitRows(units: PmServiceUnitSnapshot[]): PmServiceCard['units'] {
  return units.map((unit) => ({
    id: unit.id,
    unitLabel: unit.unitLabel,
    vendorName: unit.vendorName?.trim() || null,
    visitLabel: formatVisit(unit.visitAt ?? unit.windowStart),
    cost: unit.cost ?? null,
  }))
}

function totalCost(units: PmServiceUnitSnapshot[]): number | null {
  const costs = units.map((unit) => unit.cost).filter((cost): cost is number => typeof cost === 'number')
  if (costs.length === 0) return null
  return costs.reduce((sum, cost) => sum + cost, 0)
}

export function canSnoozePmServiceCard(
  input: {
    subtype: PmServiceAttentionSubtype
    safety: boolean
    windowStart?: string | null
  },
  now = new Date(),
): boolean {
  if (input.subtype === 'overdue') return false
  if (input.subtype === 'service_finding' && input.safety) return false
  const start = time(input.windowStart)
  if (start == null) return true
  const until = now.getTime() + SNOOZE_MS
  return until <= start
}

export function pmServiceBadge(input: {
  subtype: PmServiceAttentionSubtype
  safety: boolean
  windowStart?: string | null
  visitAt?: string | null
  now?: Date
}): 'critical' | 'warning' {
  if (input.subtype === 'service_finding' && input.safety) return 'critical'
  if (input.subtype === 'overdue') return 'critical'
  if (input.subtype === 'batch_approval') {
    const start = time(input.windowStart ?? input.visitAt)
    const now = input.now ?? new Date()
    if (start != null && start - now.getTime() <= BATCH_CRITICAL_WINDOW_MS && start >= now.getTime()) {
      return 'critical'
    }
  }
  return 'warning'
}

function cardShell(input: {
  subtype: PmServiceAttentionSubtype
  batch: PmServiceBatchSnapshot
  units: PmServiceUnitSnapshot[]
  title: string
  meta: string
  safety: boolean
  dueAt: string | null
  idempotencyKey: string
  now: Date
}): PmServiceCard {
  const windowStart = soonest(input.units.map((unit) => unit.windowStart ?? unit.visitAt))
  const badge = pmServiceBadge({
    subtype: input.subtype,
    safety: input.safety,
    windowStart,
    visitAt: soonest(input.units.map((unit) => unit.visitAt)),
    now: input.now,
  })
  return {
    key: input.idempotencyKey,
    idempotencyKey: input.idempotencyKey,
    subtype: input.subtype,
    batchId: input.batch.batchId,
    title: input.title,
    context: input.batch.propertyLabel,
    meta: input.meta,
    badge,
    safety: input.safety,
    dueAt: input.dueAt,
    windowStart,
    canSnooze: canSnoozePmServiceCard(
      { subtype: input.subtype, safety: input.safety, windowStart },
      input.now,
    ),
    units: unitRows(input.units),
    totalCost: totalCost(input.units),
  }
}

function batchOpen(batch: PmServiceBatchSnapshot, now: Date): boolean {
  if (batch.resolution === 'app' || batch.resolution === 'sms' || batch.resolution === 'declined') {
    return false
  }
  const snooze = time(batch.snoozedUntil)
  return snooze == null || snooze <= now.getTime()
}

/**
 * Open HVAC attention cards for one batch.
 * A proposed batch is one card, not one card per unit.
 * Scheduled, confirmed, and completed visits are omitted.
 */
export function derivePmServiceCards(
  batch: PmServiceBatchSnapshot,
  now = new Date(),
): PmServiceCard[] {
  const snoozed = !batchOpen({ ...batch, resolution: null }, now)
  const batchResolved =
    batch.resolution === 'app' || batch.resolution === 'sms' || batch.resolution === 'declined'
  const active = batch.units.filter((unit) => !quietUnit(unit))

  const cards: PmServiceCard[] = []
  const proposed = active.filter((unit) => unit.phase === 'proposed')
  if (!batchResolved && !snoozed && proposed.length > 0) {
    const vendor = proposed.find((unit) => unit.vendorName?.trim())?.vendorName?.trim()
    const start = soonest(proposed.map((unit) => unit.windowStart ?? unit.visitAt))
    const cost = formatMoney(totalCost(proposed))
    cards.push(
      cardShell({
        subtype: 'batch_approval',
        batch,
        units: proposed,
        title: 'Preventive HVAC',
        meta: [vendor, start ? formatVisit(start) : null, cost, `${proposed.length} units`]
          .filter(Boolean)
          .join(' · '),
        safety: false,
        dueAt: start,
        idempotencyKey: pmServiceIdempotencyKey('batch_approval', { batchId: batch.batchId }),
        now,
      }),
    )
  }

  for (const unit of active) {
    if (unit.phase === 'proposed') continue
    const ended = time(unit.windowEnd)
    const overdue =
      ended != null &&
      ended < now.getTime() &&
      unit.taskStatus !== 'completed' &&
      !unit.rescheduled
    if (overdue) {
      cards.push(
        cardShell({
          subtype: 'overdue',
          batch,
          units: [unit],
          title: 'Preventive HVAC overdue',
          meta: `${unit.unitLabel} · window ended ${formatVisit(unit.windowEnd)}`,
          safety: false,
          dueAt: unit.windowEnd ?? null,
          idempotencyKey: pmServiceIdempotencyKey('overdue', {
            planId: unit.planId,
            windowEnd: unit.windowEnd,
          }),
          now,
        }),
      )
    }

    const asked = time(unit.vendorAskedAt)
    const vendorUnavailable =
      unit.vendorResponse === 'declined' ||
      (unit.vendorResponse === 'pending' && asked != null && now.getTime() - asked >= VENDOR_WAIT_MS)
    if (vendorUnavailable) {
      cards.push(
        cardShell({
          subtype: 'vendor_unavailable',
          batch,
          units: [unit],
          title: 'HVAC vendor unavailable',
          meta: unit.vendorResponse === 'declined'
            ? `${unit.vendorName || 'The vendor'} declined ${unit.unitLabel}`
            : `No availability for ${unit.unitLabel} within 48 hours`,
          safety: false,
          dueAt: unit.visitAt ?? unit.windowStart ?? null,
          idempotencyKey: pmServiceIdempotencyKey('vendor_unavailable', { planId: unit.planId }),
          now,
        }),
      )
    }

    const visit = time(unit.visitAt)
    const tenantUnconfirmed =
      visit != null &&
      visit - now.getTime() <= TENANT_CONFIRM_WINDOW_MS &&
      visit >= now.getTime() &&
      unit.tenantConfirmed !== true
    if (tenantUnconfirmed) {
      cards.push(
        cardShell({
          subtype: 'tenant_unconfirmed',
          batch,
          units: [unit],
          title: 'Resident has not confirmed HVAC',
          meta: `${unit.unitLabel} · visit ${formatVisit(unit.visitAt)}`,
          safety: false,
          dueAt: unit.visitAt ?? null,
          idempotencyKey: pmServiceIdempotencyKey('tenant_unconfirmed', {
            planId: unit.planId,
            visitAt: unit.visitAt,
          }),
          now,
        }),
      )
    }

  }

  for (const unit of batch.units) {
    if (!isPmServiceFinding(unit.completionNotes)) continue
    const safety = isPmServiceSafetyFinding(unit.completionNotes)
    if (snoozed && !safety) continue
    cards.push(
      cardShell({
        subtype: 'service_finding',
        batch,
        units: [unit],
        title: safety ? 'HVAC safety finding' : 'HVAC service finding',
        meta: unit.completionNotes?.trim() || unit.unitLabel,
        safety,
        dueAt: unit.visitAt ?? unit.windowEnd ?? null,
        idempotencyKey: pmServiceIdempotencyKey('service_finding', { planId: unit.planId }),
        now,
      }),
    )
  }

  return sortPmServiceCards(cards)
}

export function sortPmServiceCards<T extends { safety: boolean; badge: 'critical' | 'warning'; dueAt: string | null }>(
  cards: T[],
): T[] {
  return [...cards].sort((a, b) => compareRankedAttention(
    { id: '', emergencyRepair: false, safety: a.safety, badge: a.badge, dueAt: a.dueAt },
    { id: '', emergencyRepair: false, safety: b.safety, badge: b.badge, dueAt: b.dueAt },
  ))
}

function bucket(item: RankedAttention): number {
  if (item.emergencyRepair) return 0
  if (item.safety) return 1
  if (item.badge === 'critical') return 2
  return 3
}

export function compareRankedAttention(a: RankedAttention, b: RankedAttention): number {
  const rank = bucket(a) - bucket(b)
  if (rank !== 0) return rank
  const aDue = time(a.dueAt) ?? Number.POSITIVE_INFINITY
  const bDue = time(b.dueAt) ?? Number.POSITIVE_INFINITY
  return aDue - bDue
}

export function sortNeedsAttention<T extends RankedAttention>(items: T[]): T[] {
  return [...items].sort(compareRankedAttention)
}

/** Second cron pass sends nothing that was already sent for the same key. */
export function pmServiceKeysToNotify(cards: PmServiceCard[], alreadySent: Iterable<string>): string[] {
  const sent = new Set(alreadySent)
  const keys: string[] = []
  for (const card of cards) {
    if (sent.has(card.idempotencyKey)) continue
    sent.add(card.idempotencyKey)
    keys.push(card.idempotencyKey)
  }
  return keys
}

export function partialApprovalSummary(approved: number, skipped: number): string {
  return `${approved} approved, ${skipped} skipped`
}

export function approvePmServiceSelection(
  batch: PmServiceBatchSnapshot,
  tickedUnitIds: string[],
): { resolvedVia: 'app'; summary: string; cleared: true } {
  const openIds = batch.units.filter((unit) => unit.phase === 'proposed').map((unit) => unit.id)
  const ticked = new Set(tickedUnitIds)
  const approved = openIds.filter((id) => ticked.has(id)).length
  const skipped = openIds.length - approved
  return {
    resolvedVia: 'app',
    summary: skipped > 0 ? partialApprovalSummary(approved, skipped) : `${approved} approved`,
    cleared: true,
  }
}

export const ALREADY_APPROVED_IN_APP = 'Already approved in the app.'

export function resolveYesHvacReply(batch: Pick<PmServiceBatchSnapshot, 'resolution'>): {
  reply: string
  cleared: boolean
} {
  if (batch.resolution === 'app' || batch.resolution === 'sms') {
    return { reply: ALREADY_APPROVED_IN_APP, cleared: true }
  }
  return { reply: 'Approved. We will schedule the HVAC service.', cleared: true }
}

export const PM_SERVICE_ASK_KEY = 'awaiting_pm_service'

export function canHandlePmServiceYesHvac(input: {
  body: string | null | undefined
  intakeState?: Record<string, unknown> | null
}): boolean {
  if (!isYesHvacReply(input.body)) return false
  const ask = input.intakeState?.[PM_SERVICE_ASK_KEY]
  return Boolean(ask && typeof ask === 'object')
}
