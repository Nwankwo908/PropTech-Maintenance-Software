import { describe, expect, it } from 'vitest'
import {
  buildIntakeUnderstandingConfirm,
  detectRecurringIssueSignal,
} from '@shared/maintenance/recurringIssueSignal.ts'
import { extractIssueNounPhrase } from '@shared/maintenance/issueNounPhrase.ts'
import { computePortfolioInsights } from '@shared/portfolioIntelligence'
import type { PortfolioIntelligenceInput } from '@shared/portfolioIntelligence'

const BYRON_BODY =
  "Hi and thank you I was trying to see if an exterminator can come out to spray the property Tenant update: Repeatedly this isn't the first time someone came out before."

describe('intake understanding confirm (Byron-style)', () => {
  it('extracts pest control without quoting greeting or Tenant update scaffolding', () => {
    const extracted = extractIssueNounPhrase(BYRON_BODY, 'pest_control')
    expect(extracted.phrase).toBe('a pest control request')
    expect(extracted.phrase).not.toMatch(/hi|thank you|tenant update/i)
  })

  it('detects recurring language in the update', () => {
    expect(detectRecurringIssueSignal(BYRON_BODY)).toBe(true)
    expect(detectRecurringIssueSignal('I saw one roach in the kitchen')).toBe(false)
  })

  it('builds a plain confirmation with recurring signal', () => {
    const phrase = extractIssueNounPhrase(BYRON_BODY, 'pest_control').phrase
    const line = buildIntakeUnderstandingConfirm({
      issuePhrase: phrase,
      recurring: true,
    })
    expect(line).toBe(
      'Got it — pest control request, and it sounds like this has come up before.',
    )
    expect(line).not.toMatch(/Tenant update/i)
    expect(line).not.toMatch(/I've updated this to/i)
    expect(line).not.toMatch(/Hi and thank you/i)
  })
})

describe('Property Insights recurring from separate jobs', () => {
  it('does not surface RECURRING ISSUES from resident language alone', () => {
    const input: PortfolioIntelligenceInput = {
      tickets: [
        {
          id: 't1',
          building: '14 Maple Ave',
          unit: '1',
          issueCategory: 'pest_control',
          description: BYRON_BODY,
          vendorWorkStatus: 'unassigned',
          createdAt: new Date().toISOString(),
          residentReportedRecurring: true,
        },
      ],
      units: [{ unitLabel: '1', building: '14 Maple Ave' }],
      now: Date.now(),
    }
    const insights = computePortfolioInsights(input)
    expect(insights.some((i) => i.tag === 'RECURRING ISSUES')).toBe(false)
  })

  it('surfaces RECURRING ISSUES when two separate jobs share building + category', () => {
    const now = Date.now()
    const input: PortfolioIntelligenceInput = {
      tickets: [
        {
          id: 't1',
          building: '14 Maple Ave',
          unit: '1',
          propertyId: 'prop-maple',
          issueCategory: 'pest_control',
          vendorWorkStatus: 'completed',
          createdAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: 't2',
          building: '14 Maple Ave',
          unit: '1',
          propertyId: 'prop-maple',
          issueCategory: 'pest_control',
          vendorWorkStatus: 'unassigned',
          createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
      units: [{ unitLabel: '1', building: '14 Maple Ave', propertyId: 'prop-maple' }],
      now,
    }
    const insights = computePortfolioInsights(input)
    const recurring = insights.find((i) => i.tag === 'RECURRING ISSUES')
    expect(recurring?.requestCount).toBe(2)
  })
})
