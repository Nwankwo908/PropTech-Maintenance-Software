import { describe, expect, it } from 'vitest'
import { computePortfolioInsights } from '@shared/portfolioIntelligence'
import type { PortfolioIntelligenceInput } from '@shared/portfolioIntelligence'

const NOW = Date.parse('2026-08-07T12:00:00.000Z')

function daysAgo(n: number): string {
  return new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
}

const PROP_OAK = 'prop-oak-0001'

describe('computePortfolioInsights', () => {
  it('does not use cancelled or deleted work orders for pattern cards', () => {
    const input: PortfolioIntelligenceInput = {
      now: NOW,
      units: [{ unitLabel: '4B', building: 'Oak Tower', propertyId: PROP_OAK }],
      tickets: [
        {
          id: 'cancelled-1',
          propertyId: PROP_OAK,
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
          propertyId: PROP_OAK,
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
          propertyId: PROP_OAK,
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

  it('does not treat a single resident-flagged ticket as recurring', () => {
    const insights = computePortfolioInsights({
      now: NOW,
      units: [{ unitLabel: '1', building: '14 Maple Ave', propertyId: 'prop-a' }],
      tickets: [
        {
          id: 'solo',
          propertyId: 'prop-a',
          building: '14 Maple Ave',
          unit: '1',
          issueCategory: 'pest_control',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(3),
          residentReportedRecurring: true,
          urgency: 'normal',
        },
      ],
    })
    expect(insights.some((i) => i.tag === 'RECURRING ISSUES')).toBe(false)
  })

  it('excludes inspection-sourced tickets from pattern cards', () => {
    const insights = computePortfolioInsights({
      now: NOW,
      units: [{ unitLabel: '1', building: '646 Bartlett', propertyId: PROP_OAK }],
      tickets: Array.from({ length: 12 }, (_, i) => ({
        id: `hqs-${i}`,
        propertyId: PROP_OAK,
        building: '646 Bartlett',
        unit: '1',
        issueCategory: 'general',
        vendorWorkStatus: 'pending_accept',
        createdAt: daysAgo(2),
        urgency: 'normal',
        inspectionReportId: 'insp-1',
      })),
    })
    expect(insights.some((i) => i.tag === 'RECURRING ISSUES')).toBe(false)
    expect(insights.some((i) => i.tag === 'RISK')).toBe(false)
    expect(insights.some((i) => i.tag === 'PREVENT FUTURE REPAIRS')).toBe(false)
  })

  it('still counts completed repairs in the 60-day window', () => {
    const insights = computePortfolioInsights({
      now: NOW,
      units: [{ unitLabel: '4B', building: 'Oak Tower', propertyId: PROP_OAK }],
      tickets: [
        {
          id: 'done-1',
          propertyId: PROP_OAK,
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(5),
          urgency: 'normal',
        },
        {
          id: 'done-2',
          propertyId: PROP_OAK,
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(10),
          urgency: 'normal',
        },
        {
          id: 'cancelled-noise',
          propertyId: PROP_OAK,
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
