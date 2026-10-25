import { describe, expect, it } from 'vitest'
import {
  INSIGHT_CARD_SUMMARY_MAX_CHARS,
  acceptInsightCardSummary,
  authoredInsightSummary,
  insightCardAddressLine,
  insightCardHeadline,
  resolveInsightCardSummary,
} from './insightCardSummary'
import { insightDetailSections } from './insightDetailSections'
import { insightSynthesisSystemPrompt } from './synthesizeInsightRecommendations'

describe('recommended action card summary', () => {
  it('puts the address and phrase on the same line and keeps a 20-character phrase', () => {
    expect(insightCardAddressLine('123 Main')).toBe('123 Main')
    expect(insightCardAddressLine('Unit 1')).toBe('')
    expect(insightCardAddressLine('Home')).toBe('')
    const summary = resolveInsightCardSummary({
      summary: 'Plumbing leaks',
      tag: 'RECURRING ISSUES',
      categoryLabel: 'Plumbing',
    })
    expect(summary).toBe('Plumbing leaks')
    expect(summary.length).toBeLessThanOrEqual(INSIGHT_CARD_SUMMARY_MAX_CHARS)
    expect(insightCardHeadline('123 Main', summary)).toBe('123 Main · Plumbing leaks')
    expect(insightCardHeadline('Unit 1', summary)).toBe('Plumbing leaks')
  })

  it('rejects a phrase over 20 characters instead of cutting a word', () => {
    expect(acceptInsightCardSummary('Repeat plumbing leaks')).toBeNull()
    const summary = resolveInsightCardSummary({
      summary: 'Repeat plumbing leaks',
      tag: 'RECURRING ISSUES',
      categoryLabel: 'Plumbing',
    })
    expect(summary).toBe('Repeat plumbing')
    expect(summary.length).toBeLessThanOrEqual(20)
    expect(summary).not.toMatch(/plumbin$|leak$/)
    expect(summary.includes('…')).toBe(false)
  })

  it('does not slice a single word that is longer than the limit', () => {
    const summary = resolveInsightCardSummary({
      summary: 'Supercalifragilisticx',
      tag: 'RISK',
    })
    expect(summary).toBe('Most requests')
    expect(summary.includes('Supercal')).toBe(false)
  })

  it('moves the explanation and recommendation into the details copy', () => {
    const details = insightDetailSections({
      title: 'Recurring Issues',
      building: '123 Main',
      categoryLabel: 'Plumbing',
      tag: 'RECURRING ISSUES',
      mainIssue: 'Repeated kitchen sink leaks at 123 Main.',
      text: 'Recurring Issues at 123 Main are high risk. Schedule a plumbing inspection to identify the cause and prevent repeat repairs.',
      aggregateText: 'Plumbing issues keep occurring in 123 Main.',
      ticketSummaries: [{ description: 'Kitchen sink leak' }],
    })
    expect(details.mainIssue).toBe('Repeated kitchen sink leaks.')
    expect(details.recommendedAction).toBe(
      'Schedule a plumbing inspection to identify the cause and prevent repeat repairs.',
    )
    expect(details.mainIssue.includes('123 Main')).toBe(false)
    expect(details.recommendedAction.includes('123 Main')).toBe(false)
    expect(details.recommendedAction.toLowerCase().includes('high risk')).toBe(false)
    expect(details.mainIssue.includes('Recurring Issues')).toBe(false)
  })

  it('drops an issue or repair that the work orders do not mention', () => {
    const details = insightDetailSections({
      title: 'Recurring Issues',
      building: '123 Main',
      categoryLabel: 'Plumbing',
      tag: 'RECURRING ISSUES',
      mainIssue: 'Repeated roof leaks.',
      text: 'Replace the water heater.',
      ticketSummaries: [{ description: 'Kitchen sink leak' }],
    })
    expect(details.mainIssue).toBe('Repeated kitchen sink leak.')
    expect(details.recommendedAction).toBe(
      'Schedule a plumbing inspection to identify the cause and prevent repeat repairs.',
    )
    expect(details.mainIssue.toLowerCase().includes('roof')).toBe(false)
    expect(details.recommendedAction.toLowerCase().includes('water heater')).toBe(false)
  })

  it('asks the model for a complete phrase within the same limit', () => {
    const prompt = insightSynthesisSystemPrompt()
    expect(prompt).toContain(`at most ${INSIGHT_CARD_SUMMARY_MAX_CHARS} characters`)
    expect(prompt).toContain('Never cut a word')
    expect(prompt).toContain('"summary":"Repeat plumbing"')
    expect(prompt).toContain('"mainIssue":"Repeated kitchen sink leaks."')
    expect(prompt).toContain('high risk')
    expect(authoredInsightSummary({ tag: 'VENDOR RESPONSE' }).length).toBeLessThanOrEqual(20)
  })
})
