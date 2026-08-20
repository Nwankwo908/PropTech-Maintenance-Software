import { describe, expect, it } from 'vitest'
import { computePortfolioInsights } from './computeInsights.ts'
import { computePortfolioRecommendations } from './computeRecommendations.ts'
import type { PortfolioIntelligenceInput } from './types.ts'

const NOW = Date.parse('2026-08-07T12:00:00.000Z')

function daysAgo(n: number): string {
  return new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
}

describe('computePortfolioIntelligence', () => {
  it('insights surface pattern cards from 60-day history', () => {
    const input: PortfolioIntelligenceInput = {
      now: NOW,
      units: [{ unitLabel: '4B', building: 'Oak Tower' }],
      tickets: [
        {
          id: '1',
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(5),
          urgency: 'normal',
        },
        {
          id: '2',
          building: 'Oak Tower',
          unit: '4B',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(10),
          urgency: 'normal',
        },
        {
          id: '3',
          building: 'Oak Tower',
          unit: '2A',
          issueCategory: 'plumbing',
          vendorWorkStatus: 'completed',
          createdAt: daysAgo(12),
          urgency: 'normal',
        },
      ],
    }

    const insights = computePortfolioInsights(input)
    expect(insights.some((i) => i.tag === 'RECURRING ISSUES')).toBe(true)
    expect(insights.some((i) => i.tag === 'RISK')).toBe(true)
    expect(insights.every((i) => i.tag !== 'priority_property' as never)).toBe(true)
  })

  it('recommendations surface action signals from open backlog, not insight tags', () => {
    const input: PortfolioIntelligenceInput = {
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
      ],
    }

    const recommendations = computePortfolioRecommendations(input)
    expect(recommendations.length).toBeGreaterThan(0)
    expect(recommendations[0]?.kind).toBe('priority_property')
    expect(recommendations.every((r) => r.confidence === 'high')).toBe(true)
    expect(recommendations.every((r) => !('tag' in r))).toBe(true)
  })

  it('escalation stack recommendation requires multiple escalated workflows', () => {
    const input: PortfolioIntelligenceInput = {
      now: NOW,
      units: [],
      tickets: [],
      escalatedWorkflows: [
        { id: '1', status: 'escalated', templateName: 'late_rent' },
        { id: '2', status: 'escalated', templateName: 'lease_renewal' },
        { id: '3', status: 'escalated', templateName: 'maintenance_sla' },
      ],
    }

    const recommendations = computePortfolioRecommendations(input)
    expect(recommendations.some((r) => r.kind === 'escalation_stack')).toBe(true)
    const insights = computePortfolioInsights(input)
    expect(insights.length).toBe(0)
  })

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
})
