import { describe, expect, it } from 'vitest'
import {
  classifyActiveTasksKpiBucket,
  computeActiveTasksKpis,
  type ActiveTasksKpiCard,
} from '@/lib/activeTasksKpis'

const NOW = Date.parse('2026-11-06T15:00:00-05:00')

function card(partial: Partial<ActiveTasksKpiCard> & { id: string }): ActiveTasksKpiCard {
  return {
    stage: 'assigned',
    critical: false,
    ticketId: partial.id,
    dueAt: null,
    scheduledAt: null,
    scheduleConfirmedAt: null,
    vendorWorkStatus: 'pending_accept',
    ...partial,
  }
}

describe('classifyActiveTasksKpiBucket', () => {
  it('skips completed cards', () => {
    expect(
      classifyActiveTasksKpiBucket(card({ id: '1', stage: 'completed' }), NOW),
    ).toBeNull()
  })

  it('puts critical cards in needs attention first', () => {
    expect(
      classifyActiveTasksKpiBucket(
        card({
          id: '1',
          critical: true,
          dueAt: '2026-11-05T12:00:00Z',
          vendorWorkStatus: 'pending_accept',
        }),
        NOW,
      ),
    ).toBe('needs_attention')
  })

  it('puts past-due waiting tickets in overdue', () => {
    expect(
      classifyActiveTasksKpiBucket(
        card({
          id: '1',
          dueAt: '2026-11-05T12:00:00Z',
          vendorWorkStatus: 'pending_accept',
        }),
        NOW,
      ),
    ).toBe('overdue')
  })

  it('puts confirmed visits today in scheduled today', () => {
    expect(
      classifyActiveTasksKpiBucket(
        card({
          id: '1',
          vendorWorkStatus: 'accepted',
          scheduledAt: '2026-11-06T18:00:00-05:00',
          scheduleConfirmedAt: '2026-11-06T10:00:00-05:00',
        }),
        NOW,
      ),
    ).toBe('scheduled_today')
  })

  it('puts ordinary open work in waiting on others', () => {
    expect(
      classifyActiveTasksKpiBucket(
        card({ id: '1', vendorWorkStatus: 'accepted', stage: 'in_progress' }),
        NOW,
      ),
    ).toBe('waiting_on_others')
  })
})

describe('computeActiveTasksKpis', () => {
  it('counts mutually exclusive buckets', () => {
    const kpis = computeActiveTasksKpis(
      [
        card({ id: 'a', critical: true }),
        card({
          id: 'b',
          dueAt: '2026-11-01T12:00:00Z',
          vendorWorkStatus: 'unassigned',
        }),
        card({
          id: 'c',
          vendorWorkStatus: 'accepted',
          scheduledAt: '2026-11-06T18:00:00-05:00',
          scheduleConfirmedAt: '2026-11-06T10:00:00-05:00',
        }),
        card({ id: 'd', vendorWorkStatus: 'in_progress', stage: 'in_progress' }),
        card({ id: 'e', stage: 'completed' }),
      ],
      NOW,
    )

    expect(kpis).toEqual({
      needsYourAttention: 1,
      waitingOnOthers: 1,
      scheduledToday: 1,
      overdue: 1,
      runIdsByBucket: {
        needs_attention: ['a'],
        waiting_on_others: ['d'],
        scheduled_today: ['c'],
        overdue: ['b'],
      },
    })
  })
})
