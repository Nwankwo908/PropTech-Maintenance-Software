import { describe, expect, it } from 'vitest'
import { computePortfolioInsights } from './computeInsights.ts'
import {
  applyInsightSynthesis,
  buildFallbackInsightRecommendations,
  mergeInsightRecommendations,
} from './synthesizeInsightRecommendations.ts'
import type { PortfolioInsightFinding } from './types.ts'

const NOW = Date.parse('2026-08-07T12:00:00.000Z')

function daysAgo(n: number): string {
  return new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString()
}

function sampleFindings(): PortfolioInsightFinding[] {
  return computePortfolioInsights({
    now: NOW,
    units: [{ id: 'unit-4b', unitLabel: '4B', building: 'Oak Tower' }],
    tickets: [
      {
        id: 't1',
        building: 'Oak Tower',
        unit: '4B',
        unitId: 'unit-4b',
        issueCategory: 'plumbing',
        description: 'Kitchen sink leaking',
        vendorWorkStatus: 'completed',
        createdAt: daysAgo(5),
        urgency: 'normal',
      },
      {
        id: 't2',
        building: 'Oak Tower',
        unit: '4B',
        unitId: 'unit-4b',
        issueCategory: 'plumbing',
        description: 'Bathroom drain clogged',
        vendorWorkStatus: 'completed',
        createdAt: daysAgo(10),
        urgency: 'normal',
      },
      {
        id: 't3',
        building: 'Oak Tower',
        unit: '4B',
        unitId: 'unit-4b',
        issueCategory: 'plumbing',
        description: 'Under-sink pipe drip',
        vendorWorkStatus: 'completed',
        createdAt: daysAgo(12),
        urgency: 'normal',
      },
    ],
  })
}

describe('applyInsightSynthesis', () => {
  it('falls back to plain aggregate cards when the synthesis call fails', () => {
    const findings = sampleFindings()
    const plain = buildFallbackInsightRecommendations(findings)
    const result = applyInsightSynthesis(findings, null, { failed: true })

    expect(result.length).toBe(plain.length)
    expect(result.every((card) => card.mode === 'fallback')).toBe(true)
    expect(result.map((c) => c.text)).toEqual(plain.map((c) => c.text))
    expect(result.every((c) => c.aggregateText === c.text)).toBe(true)
  })

  it('merges two aggregates rooted in the same ticket IDs into one recommendation', () => {
    const findings: PortfolioInsightFinding[] = [
      {
        tag: 'RECURRING ISSUES',
        text: 'Plumbing issues keep occurring in Oak Tower.',
        score: 80,
        ticketIds: ['t1', 't2'],
        ticketSummaries: [
          { id: 't1', description: 'Kitchen sink leaking' },
          { id: 't2', description: 'Bathroom drain clogged' },
        ],
      },
      {
        tag: 'RISK',
        text: 'Unit 4B has generated the most maintenance requests.',
        score: 72,
        unitLabel: 'Unit 4B',
        unitId: 'unit-4b',
        ticketIds: ['t1', 't2'],
        ticketSummaries: [
          { id: 't1', description: 'Kitchen sink leaking' },
          { id: 't2', description: 'Bathroom drain clogged' },
        ],
      },
    ]

    const merged = mergeInsightRecommendations(
      buildFallbackInsightRecommendations(findings),
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.ticketIds.sort()).toEqual(['t1', 't2'])
    expect(merged[0]?.sourceTags).toEqual(
      expect.arrayContaining(['RECURRING ISSUES', 'RISK']),
    )

    const synthesized = applyInsightSynthesis(findings, {
      recommendations: [
        {
          sourceTags: ['RECURRING ISSUES'],
          mergeGroup: 'plumbing-4b',
          recommendation: 'Schedule a plumbing diagnostic for Unit 4B.',
          urgency: 88,
          confidence: 82,
          actionType: 'request_diagnostic',
        },
        {
          sourceTags: ['RISK'],
          mergeGroup: 'plumbing-4b',
          recommendation: 'Unit 4B needs a focused repair plan.',
          urgency: 70,
          confidence: 75,
          actionType: 'request_diagnostic',
        },
      ],
    })
    expect(synthesized).toHaveLength(1)
    expect(synthesized[0]?.actionType).toBe('request_diagnostic')
    expect(synthesized[0]?.ticketIds.sort()).toEqual(['t1', 't2'])
  })

  it('uses plain aggregate text when confidence is low instead of dropping the card', () => {
    const findings = sampleFindings().slice(0, 1)
    const result = applyInsightSynthesis(findings, {
      recommendations: [
        {
          sourceTags: [findings[0]!.tag],
          recommendation: 'Invented unsupported advice.',
          urgency: 90,
          confidence: 20,
          actionType: 'none',
        },
      ],
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.text).toBe(findings[0]!.text)
    expect(result[0]?.mode).toBe('fallback')
  })
})
