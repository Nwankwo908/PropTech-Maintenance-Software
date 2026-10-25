import { describe, expect, it } from 'vitest'
import {
  ALREADY_APPROVED_IN_APP,
  approvePmServiceSelection,
  canSnoozePmServiceCard,
  derivePmServiceCards,
  pmServiceKeysToNotify,
  resolveYesHvacReply,
  sortNeedsAttention,
  type PmServiceBatchSnapshot,
  type PmServiceUnitSnapshot,
} from './pmServiceAttention'

const NOW = new Date('2026-10-25T16:00:00.000Z')

function unit(overrides: Partial<PmServiceUnitSnapshot> = {}): PmServiceUnitSnapshot {
  return {
    id: 'unit-1',
    planId: 'plan-1',
    unitLabel: 'Unit 1',
    vendorName: 'North HVAC',
    cost: 180,
    phase: 'proposed',
    taskStatus: 'scheduled',
    windowStart: '2026-11-20T15:00:00.000Z',
    windowEnd: '2026-11-20T18:00:00.000Z',
    visitAt: '2026-11-20T15:00:00.000Z',
    vendorResponse: null,
    tenantConfirmed: false,
    completionNotes: null,
    rescheduled: false,
    ...overrides,
  }
}

function batch(units: PmServiceUnitSnapshot[], overrides: Partial<PmServiceBatchSnapshot> = {}): PmServiceBatchSnapshot {
  return {
    batchId: 'batch-1',
    propertyLabel: '123 Main',
    units,
    resolution: null,
    ...overrides,
  }
}

describe('preventive HVAC attention', () => {
  it('creates one card per batch, not one per unit', () => {
    const cards = derivePmServiceCards(
      batch([
        unit({ id: 'a', planId: 'p1', unitLabel: '1' }),
        unit({ id: 'b', planId: 'p2', unitLabel: '2' }),
        unit({ id: 'c', planId: 'p3', unitLabel: '3' }),
      ]),
      NOW,
    )
    expect(cards).toHaveLength(1)
    expect(cards[0]?.subtype).toBe('batch_approval')
    expect(cards[0]?.idempotencyKey).toBe('pm_batch:batch-1')
    expect(cards[0]?.units).toHaveLength(3)
  })

  it('does not create cards for scheduled, confirmed, or completed visits', () => {
    const cards = derivePmServiceCards(
      batch([
        unit({ phase: 'scheduled' }),
        unit({ id: 'b', planId: 'p2', phase: 'confirmed' }),
        unit({ id: 'c', planId: 'p3', phase: 'completed', taskStatus: 'completed' }),
      ]),
      NOW,
    )
    expect(cards).toEqual([])
  })

  it('clears a batch card after approval in the app, and a later YES HVAC says it was already approved', () => {
    const open = batch([unit(), unit({ id: 'b', planId: 'p2' })])
    expect(derivePmServiceCards(open, NOW)).toHaveLength(1)
    const approved = approvePmServiceSelection(open, ['unit-1', 'b'])
    expect(approved.cleared).toBe(true)
    const after = batch(open.units, { resolution: approved.resolvedVia })
    expect(derivePmServiceCards(after, NOW).some((card) => card.subtype === 'batch_approval')).toBe(false)
    expect(resolveYesHvacReply(after).reply).toBe(ALREADY_APPROVED_IN_APP)
  })

  it('records a partial approval as approved and skipped, then clears the card', () => {
    const open = batch(
      Array.from({ length: 12 }, (_, index) =>
        unit({ id: `u${index + 1}`, planId: `p${index + 1}`, unitLabel: String(index + 1) }),
      ),
    )
    const ticked = open.units.slice(0, 11).map((row) => row.id)
    const result = approvePmServiceSelection(open, ticked)
    expect(result.summary).toBe('11 approved, 1 skipped')
    expect(result.cleared).toBe(true)
    expect(
      derivePmServiceCards(batch(open.units, { resolution: 'app' }), NOW).some(
        (card) => card.subtype === 'batch_approval',
      ),
    ).toBe(false)
  })

  it('does not allow snooze on an overdue card', () => {
    const cards = derivePmServiceCards(
      batch([
        unit({
          phase: 'declined',
          windowEnd: '2026-10-20T16:00:00.000Z',
          taskStatus: 'assigned',
        }),
      ]),
      NOW,
    )
    const overdue = cards.find((card) => card.subtype === 'overdue')
    expect(overdue?.badge).toBe('critical')
    expect(overdue?.canSnooze).toBe(false)
    expect(
      canSnoozePmServiceCard({ subtype: 'overdue', safety: false, windowStart: overdue?.windowStart }, NOW),
    ).toBe(false)
  })

  it('marks a safety finding critical and sorts it above batch approvals', () => {
    const cards = derivePmServiceCards(
      batch([
        unit({ id: 'soon', planId: 'soon', windowStart: '2026-10-28T15:00:00.000Z' }),
        unit({
          id: 'finding',
          planId: 'finding',
          phase: 'completed',
          taskStatus: 'completed',
          completionNotes: 'Cracked heat exchanger and CO near the furnace',
          visitAt: '2026-12-01T15:00:00.000Z',
        }),
      ]),
      NOW,
    )
    const finding = cards.find((card) => card.subtype === 'service_finding')
    const approval = cards.find((card) => card.subtype === 'batch_approval')
    expect(finding?.safety).toBe(true)
    expect(finding?.badge).toBe('critical')
    expect(approval?.badge).toBe('critical')
    expect(cards[0]?.subtype).toBe('service_finding')

    const mixed = sortNeedsAttention([
      { id: 'hvac-safety', safety: true, badge: 'critical', dueAt: '2026-12-01T15:00:00.000Z' },
      { id: 'emergency', emergencyRepair: true, badge: 'critical', dueAt: '2026-12-15T15:00:00.000Z' },
      { id: 'approval', badge: 'critical' as const, dueAt: '2026-10-28T15:00:00.000Z' },
    ])
    expect(mixed.map((item) => item.id)).toEqual(['emergency', 'hvac-safety', 'approval'])
  })

  it('does not create a second card when the cron runs again', () => {
    const cards = derivePmServiceCards(batch([unit(), unit({ id: 'b', planId: 'p2' })]), NOW)
    const first = pmServiceKeysToNotify(cards, [])
    expect(first).toEqual(['pm_batch:batch-1'])
    expect(pmServiceKeysToNotify(cards, first)).toEqual([])
  })
})
