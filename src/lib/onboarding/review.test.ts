import { describe, expect, it } from 'vitest'
import { buildOnboardingReviewMetrics } from './review'
import { sampleResident, sampleVendor, validOnboardingState } from './testFixtures'

describe('buildOnboardingReviewMetrics', () => {
  it('prefers draft property and unit totals when present', () => {
    const state = validOnboardingState({
      properties: [
        {
          id: 'p1',
          name: 'A',
          streetAddress: '1 Main',
          city: 'Atlanta',
          state: 'GA',
          zipCode: '30301',
          unitCount: 3,
        },
        {
          id: 'p2',
          name: 'B',
          streetAddress: '2 Main',
          city: 'Atlanta',
          state: 'GA',
          zipCode: '30301',
          unitCount: 5,
        },
      ],
    })
    const metrics = buildOnboardingReviewMetrics(
      state,
      [sampleVendor(), sampleVendor({ id: 'v2', name: 'Other' })],
      [sampleResident()],
      { properties: 99, units: 99, vendors: 99, residents: 99, workflowRuns: 7 },
    )
    expect(metrics).toEqual({
      properties: 2,
      units: 8,
      vendors: 2,
      residents: 1,
      workflowRuns: 7,
    })
  })

  it('falls back to dbCounts when the draft has no properties/units', () => {
    const state = validOnboardingState({ properties: [] })
    const metrics = buildOnboardingReviewMetrics(state, [], [], {
      properties: 2,
      units: 10,
      vendors: 0,
      residents: 0,
      workflowRuns: 3,
    })
    expect(metrics.properties).toBe(2)
    expect(metrics.units).toBe(10)
    expect(metrics.vendors).toBe(0)
    expect(metrics.residents).toBe(0)
    expect(metrics.workflowRuns).toBe(3)
  })

  it('counts extracted unit labels instead of a stale GPT unitCount', () => {
    const state = validOnboardingState({
      properties: [
        {
          id: 'p1',
          name: 'Maple Court',
          streetAddress: '100 Maple St',
          city: 'Atlanta',
          state: 'GA',
          zipCode: '30301',
          unitCount: 4,
          unitLabels: ['101', '102', '103', '104', '105', '106', '107', '108', '109'],
        },
      ],
    })
    expect(buildOnboardingReviewMetrics(state, [], []).units).toBe(9)
  })
})
