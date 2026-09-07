import { describe, expect, it } from 'vitest'
import {
  calculatePropertyHealth,
  propertyHealthRatingFromScore,
  type CalculatePropertyHealthTicket,
} from '@/lib/propertyHealth/calculatePropertyHealth'

const now = Date.parse('2026-09-07T12:00:00.000Z')

function ticket(
  partial: Partial<CalculatePropertyHealthTicket> & Pick<CalculatePropertyHealthTicket, 'id'>,
): CalculatePropertyHealthTicket {
  return {
    createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    unit: '101',
    issueCategory: 'plumbing',
    vendorWorkStatus: 'accepted',
    description: 'Kitchen sink drip',
    urgency: 'normal',
    ...partial,
  }
}

describe('calculatePropertyHealth', () => {
  it('does not lower Condition when system data is missing', () => {
    const result = calculatePropertyHealth({
      trackedUnits: [{ unitLabel: '101', status: 'active' }],
      tickets: [],
      pmTasks: [],
      assets: [],
      inspections: [],
      damageReports: [],
      now,
    })

    expect(result.condition.score).toBeNull()
    expect(result.maintenance.score).toBe(100)
    expect(result.risk.score).toBe(100)
    expect(result.score).toBe(100)
    expect(result.rating).toBe('Excellent')
    expect(result.condition.factors.every((factor) => factor.status === 'unknown')).toBe(true)
  })

  it('does not keep penalizing completed maintenance', () => {
    const result = calculatePropertyHealth({
      trackedUnits: [{ unitLabel: '101', status: 'active' }],
      tickets: [
        ticket({
          id: 'closed',
          vendorWorkStatus: 'completed',
          description: 'Kitchen sink was leaking',
          urgency: 'urgent',
        }),
      ],
      pmTasks: [{ taskStatus: 'completed', dueAt: new Date(now - 86400000).toISOString() }],
      assets: [],
      inspections: [],
      damageReports: [],
      now,
    })

    expect(result.maintenance.score).toBe(100)
    expect(result.topIssues).toEqual([])
  })

  it('deducts for an open plumbing request and aging roof', () => {
    const result = calculatePropertyHealth({
      trackedUnits: [{ unitLabel: '101', status: 'active' }],
      tickets: [ticket({ id: 'open-plumb', description: 'Kitchen sink is leaking' })],
      pmTasks: [],
      assets: [
        {
          applianceType: 'roof',
          estimatedAgeYears: 24,
          usefulLifeYears: 25,
          replacementUrgency: 'soon',
          condition: null,
        },
      ],
      inspections: [],
      damageReports: [],
      now,
    })

    expect(result.condition.score).toBe(85)
    expect(result.maintenance.score).toBeLessThan(100)
    expect(result.topIssues.some((issue) => /roof/i.test(issue.explanation))).toBe(true)
    expect(result.topIssues.some((issue) => /leak/i.test(issue.explanation))).toBe(true)
    expect(result.rating).toBe(propertyHealthRatingFromScore(result.score!))
  })

  it('treats smoke detector status as unknown without deducting', () => {
    const result = calculatePropertyHealth({
      trackedUnits: [{ unitLabel: '101', status: 'active' }],
      tickets: [],
      pmTasks: [],
      assets: [],
      inspections: [],
      damageReports: [],
      now,
    })

    const smoke = result.risk.factors.find((factor) => factor.id === 'risk.smoke_co')
    expect(smoke?.status).toBe('unknown')
    expect(smoke?.deduction).toBe(0)
  })

  it('applies a modest vacancy deduction on Risk only', () => {
    const occupied = calculatePropertyHealth({
      trackedUnits: [{ unitLabel: '101', status: 'active' }],
      tickets: [],
      pmTasks: [],
      assets: [],
      inspections: [],
      damageReports: [],
      now,
    })
    const vacant = calculatePropertyHealth({
      trackedUnits: [{ unitLabel: '101', status: 'vacant' }],
      tickets: [],
      pmTasks: [],
      assets: [],
      inspections: [],
      damageReports: [],
      now,
    })

    expect(occupied.risk.score).toBe(100)
    expect(vacant.risk.score).toBe(97)
    expect(vacant.score).toBeLessThan(occupied.score!)
  })
})
