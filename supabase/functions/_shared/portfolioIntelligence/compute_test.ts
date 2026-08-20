/// <reference lib="deno.ns" />
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { computePortfolioInsights } from '../../../../shared/portfolioIntelligence/computeInsights.ts'
import { computePortfolioRecommendations } from '../../../../shared/portfolioIntelligence/computeRecommendations.ts'

const NOW = Date.parse('2026-08-07T12:00:00.000Z')

function daysAgo(n: number): string {
  return new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
}

Deno.test('shared portfolio intelligence — insights vs recommendations stay distinct', () => {
  const input = {
    now: NOW,
    units: [{ unitLabel: '4B', building: 'Oak Tower' }],
    tickets: [
      {
        id: 'open-1',
        building: 'Oak Tower',
        unit: '4B',
        issueCategory: 'plumbing',
        vendorWorkStatus: 'pending_accept',
        createdAt: daysAgo(15),
        urgency: 'urgent',
      },
      {
        id: 'open-2',
        building: 'Oak Tower',
        unit: '2A',
        issueCategory: 'hvac',
        vendorWorkStatus: 'in_progress',
        createdAt: daysAgo(12),
        urgency: 'normal',
      },
      {
        id: 'hist-1',
        building: 'Oak Tower',
        unit: '4B',
        issueCategory: 'plumbing',
        vendorWorkStatus: 'completed',
        createdAt: daysAgo(5),
        urgency: 'normal',
      },
      {
        id: 'hist-2',
        building: 'Oak Tower',
        unit: '4B',
        issueCategory: 'plumbing',
        vendorWorkStatus: 'completed',
        createdAt: daysAgo(8),
        urgency: 'normal',
      },
    ],
  }

  const insights = computePortfolioInsights(input)
  const recommendations = computePortfolioRecommendations(input)

  assertEquals(insights.some((i) => i.tag === 'RECURRING ISSUES'), true)
  assertEquals(recommendations.some((r) => r.kind === 'priority_property'), true)
  assertEquals(recommendations.every((r) => r.confidence === 'high'), true)
})

Deno.test('property insights ignore cancelled and deleted work orders', () => {
  const input = {
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
  assertEquals(insights.some((i) => i.tag === 'RECURRING ISSUES'), false)
  assertEquals(insights.some((i) => i.tag === 'RISK'), false)
  assertEquals(insights.some((i) => i.tag === 'PREVENT FUTURE REPAIRS'), false)
  assertEquals(insights.some((i) => i.tag === 'VENDOR RESPONSE'), false)
})
