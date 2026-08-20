import { describe, expect, it } from 'vitest'
import { computePortfolioInsights } from '@shared/portfolioIntelligence'
import type { PortfolioIntelligenceInput } from '@shared/portfolioIntelligence'

const NOW = Date.parse('2026-08-07T12:00:00.000Z')

function daysAgo(n: number): string {
  return new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
}

describe('computePortfolioInsights', () => {
  it('does not use cancelled or deleted work orders for pattern cards', () => {
    const input: PortfolioIntelligenceInput = {
      now: NOW,
      units: [{ unitLabel: '4B', building: 'Oak Tower' }],
      tickets: [
        {
          id: 'cancelled-1',
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'cancelled',
          createdAt: daysAgo(4),
          assignedVendorId: 'vendor-1',
          urgency: 'normal',
        },
        {
          id: 'cancelled-2',
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'cancelled',
          createdAt: daysAgo(6),
          assignedVendorId: 'vendor-1',
          urgency: 'normal',
        },
        {
          id: 'deleted-1',
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'deleted',
          createdAt: daysAgo(8),
          urgency: 'normal',
        },
      ],
      vendorResponsePct: 100,
      assignedWorkOrderCount: 2,
    }

    const insights = computePortfolioInsights(input)
    expect(insights.some((i) => i.tag === 'RECURRING ISSUES')).toBe(false)
    expect(insights.some((i) => i.tag === 'RISK')).toBe(false)
    expect(insights.some((i) => i.tag === 'PREVENT FUTURE REPAIRS')).toBe(false)
    expect(insights.some((i) => i.tag === 'VENDOR RESPONSE')).toBe(false)
  })

  it('still counts completed repairs in the 60-day window', () => {
    const insights = computePortfolioInsights({
      now: NOW,
      units: [{ unitLabel: '4B', building: 'Oak Tower' }],
      tickets: [
        {
          id: 'done-1',
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(5),
          urgency: 'normal',
        },
        {
          id: 'done-2',
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(10),
          urgency: 'normal',
        },
        {
          id: 'cancelled-noise',
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'cancelled',
          createdAt: daysAgo(3),
          urgency: 'normal',
        },
      ],
    })

    expect(insights.some((i) => i.tag === 'RECURRING ISSUES')).toBe(true)
    const recurring = insights.find((i) => i.tag === 'RECURRING ISSUES')
    expect(recurring?.requestCount).toBe(2)
  })
})
