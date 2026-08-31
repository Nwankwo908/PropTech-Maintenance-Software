import { describe, expect, it } from 'vitest'
import {
  isLowConfidenceDescription,
  resolveConfidenceBand,
} from '@shared/maintenance/confidencePolicy.ts'

describe('classification confidence bands', () => {
  it('marks vague asks as LOW', () => {
    for (const text of [
      'Something is wrong',
      "It's broken",
      'Please help',
      'The apartment has a problem',
      'Can you send someone',
    ]) {
      expect(isLowConfidenceDescription(text), text).toBe(true)
      expect(
        resolveConfidenceBand({
          text,
          vendorTrade: 'other',
          urgencyBand: 'medium',
          urgencyReason: 'No emergency or low-priority signal — default to a 48-hour response.',
        }).band,
        text,
      ).toBe('low')
    }
  })

  it('does not treat a real repair as LOW', () => {
    expect(isLowConfidenceDescription('Please help, the toilet is overflowing')).toBe(false)
    expect(isLowConfidenceDescription('The water pressure is low')).toBe(false)
    expect(isLowConfidenceDescription('There is a hole in the wall')).toBe(false)
  })

  it('marks clear trade + urgency as HIGH', () => {
    expect(
      resolveConfidenceBand({
        text: 'Leaky faucet',
        vendorTrade: 'plumbing',
        urgencyBand: 'medium',
        urgencyReason: 'Dripping faucet or similar minor plumbing — respond within 48 hours.',
        ruleWeight: 0.92,
        ambiguityConfidence: 0.92,
      }).band,
    ).toBe('high')
  })

  it('marks classifiable ambiguity as MEDIUM without clarification', () => {
    const r = resolveConfidenceBand({
      text: 'Water is leaking from my ceiling.',
      vendorTrade: 'plumbing',
      urgencyBand: 'emergency',
      urgencyReason: 'Water coming through a ceiling needs same-day response.',
      ambiguityConfidence: 0.58,
      ruleWeight: 0.7,
    })
    expect(r.band).toBe('medium')
    expect(r.clarificationNeeded).toBe(false)
  })
})
