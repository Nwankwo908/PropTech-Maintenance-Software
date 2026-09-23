import { describe, expect, it, vi } from 'vitest'
import {
  applyInspectorProbeAccept,
  applyInspectorProbeDeclineOrTimeout,
  decideInsightInspectorScheduling,
  entersInspectorSchedulingFlow,
  flagForReviewHref,
  isFlagForReviewAction,
  isProbeTimedOut,
  listFreeInspectorsForDay,
  probingStatusLabel,
  resolveHoldClaim,
  ticketOccupiesInspectorDay,
  toProbingState,
  INSPECTOR_PROBE_TIMEOUT_MS,
  type InspectorCandidate,
} from './insightInspectorScheduling'

const inspector = (id: string, overrides: Partial<InspectorCandidate> = {}): InspectorCandidate => ({
  vendorId: id,
  name: `Inspector ${id}`,
  category: 'inspection',
  matchable: true,
  phone: '555-0100',
  ...overrides,
})

describe('insightInspectorScheduling gates', () => {
  it('flag_for_review never enters the scheduling flow', () => {
    expect(isFlagForReviewAction('flag_for_review')).toBe(true)
    expect(entersInspectorSchedulingFlow('flag_for_review')).toBe(false)
    expect(flagForReviewHref({ assignedVendorId: 'v1' })).toBe('/admin/vendors/v1')
    expect(flagForReviewHref({})).toBe('/admin/vendors')
  })

  it('schedule and diagnostic actions enter the flow; nudge does not', () => {
    expect(entersInspectorSchedulingFlow('schedule_inspection')).toBe(true)
    expect(entersInspectorSchedulingFlow('schedule_building_inspection')).toBe(true)
    expect(entersInspectorSchedulingFlow('schedule_unit_walkthrough')).toBe(true)
    expect(entersInspectorSchedulingFlow('request_diagnostic')).toBe(true)
    expect(entersInspectorSchedulingFlow('nudge_vendor')).toBe(false)
    expect(entersInspectorSchedulingFlow('none')).toBe(false)
  })
})

describe('free inspector for target day', () => {
  it('probes when free: name withheld until accept, shown after', () => {
    const free = listFreeInspectorsForDay({
      candidates: [inspector('i1')],
      busyTickets: [],
      holds: [],
      day: '2026-09-24',
    })
    expect(free).toHaveLength(1)

    const decision = decideInsightInspectorScheduling({
      freeInspectors: free,
      holdClaim: {
        claimed: true,
        vendorId: 'i1',
        day: '2026-09-24',
        holdId: 'hold-1',
      },
      ticketId: 't1',
      targetDay: '2026-09-24',
      requestId: 'req-1',
    })
    expect(decision.outcome).toBe('probe')
    if (decision.outcome !== 'probe') return
    expect(decision.card.status).toBe('probing')
    expect(decision.card.inspectorName).toBeNull()
    expect(probingStatusLabel()).toMatch(/available inspector/i)

    const accepted = applyInspectorProbeAccept({
      ticketId: 't1',
      targetDay: '2026-09-24',
      inspectorName: 'Jordan Lee',
      confirmedWindow: 'Wed 9am–12pm',
      requestId: 'req-1',
    })
    expect(accepted.status).toBe('accepted')
    expect(accepted.inspectorName).toBe('Jordan Lee')
    expect(accepted.confirmedWindow).toBe('Wed 9am–12pm')
  })

  it('inspector free but declines → hold released path → needs_external immediately', () => {
    const probing = toProbingState({
      ticketId: 't1',
      targetDay: '2026-09-24',
      holdId: 'hold-1',
      requestId: 'req-1',
    })
    expect(probing.inspectorName).toBeNull()
    const next = applyInspectorProbeDeclineOrTimeout({
      ticketId: probing.ticketId!,
      targetDay: probing.targetDay!,
      requestId: probing.requestId,
    })
    expect(next.status).toBe('needs_external')
    expect(next.holdId).toBeNull()
    expect(next.inspectorName).toBeNull()
  })

  it('inspector free but does not respond within timeout → needs_external', () => {
    const startedAt = new Date('2026-09-23T12:00:00Z').toISOString()
    expect(
      isProbeTimedOut({
        startedAt,
        nowMs: Date.parse(startedAt) + INSPECTOR_PROBE_TIMEOUT_MS - 1,
      }),
    ).toBe(false)
    expect(
      isProbeTimedOut({
        startedAt,
        nowMs: Date.parse(startedAt) + INSPECTOR_PROBE_TIMEOUT_MS,
      }),
    ).toBe(true)

    const next = applyInspectorProbeDeclineOrTimeout({
      ticketId: 't1',
      targetDay: '2026-09-24',
      requestId: 'req-1',
    })
    expect(next.status).toBe('needs_external')
  })

  it('no inspector free at request time → external immediately, no probe', () => {
    const free = listFreeInspectorsForDay({
      candidates: [
        inspector('i1', { matchable: false }),
        inspector('i2', { category: 'plumbing' }),
      ],
      busyTickets: [],
      holds: [],
      day: '2026-09-24',
    })
    expect(free).toHaveLength(0)

    const decision = decideInsightInspectorScheduling({
      freeInspectors: free,
      holdClaim: { claimed: false, reason: 'none_free' },
      ticketId: 't1',
      targetDay: '2026-09-24',
      requestId: 'req-1',
    })
    expect(decision.outcome).toBe('needs_external')
    if (decision.outcome !== 'needs_external') return
    expect(decision.reason).toBe('none_free')
    expect(decision.card.status).toBe('needs_external')
  })

  it('busy ticket on the same day excludes the inspector', () => {
    expect(
      ticketOccupiesInspectorDay(
        {
          assignedVendorId: 'i1',
          scheduledAt: '2026-09-24T15:00:00.000Z',
          scheduleConfirmedAt: null,
        },
        '2026-09-24',
        'i1',
      ),
    ).toBe(true)

    const free = listFreeInspectorsForDay({
      candidates: [inspector('i1')],
      busyTickets: [
        {
          assignedVendorId: 'i1',
          scheduleConfirmedAt: '2026-09-24T10:00:00.000Z',
        },
      ],
      holds: [],
      day: '2026-09-24',
    })
    expect(free).toHaveLength(0)
  })
})

describe('concurrent same-day holds', () => {
  it('first claims the hold and probes; second sees none free and goes external without waiting', () => {
    const day = '2026-09-24'
    const free = [inspector('i1')]

    const firstClaim = resolveHoldClaim({ vendorId: 'i1', day, alreadyHeld: false })
    expect(firstClaim.claimed).toBe(true)

    const first = decideInsightInspectorScheduling({
      freeInspectors: free,
      holdClaim: {
        claimed: true,
        vendorId: 'i1',
        day,
        holdId: 'hold-a',
      },
      ticketId: 't-a',
      targetDay: day,
      requestId: 'req-a',
    })
    expect(first.outcome).toBe('probe')

    // Second CTA: hold already taken → free list empty after holds applied.
    const freeAfterHold = listFreeInspectorsForDay({
      candidates: [inspector('i1')],
      busyTickets: [],
      holds: [{ vendorId: 'i1', holdDate: day, status: 'held' }],
      day,
    })
    expect(freeAfterHold).toHaveLength(0)

    const secondClaim = resolveHoldClaim({ vendorId: 'i1', day, alreadyHeld: true })
    expect(secondClaim.claimed).toBe(false)

    const second = decideInsightInspectorScheduling({
      freeInspectors: freeAfterHold,
      holdClaim: { claimed: false, reason: 'already_held' },
      ticketId: 't-b',
      targetDay: day,
      requestId: 'req-b',
    })
    expect(second.outcome).toBe('needs_external')
    if (second.outcome !== 'needs_external') return
    expect(second.reason).toBe('hold_conflict')
  })
})

// Keep vi import used if we add mock spies later
void vi
