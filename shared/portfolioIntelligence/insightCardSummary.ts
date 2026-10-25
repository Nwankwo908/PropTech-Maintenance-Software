import type { PortfolioInsightTag } from './types.ts'

/** Card summary limit. The property address is not included. */
export const INSIGHT_CARD_SUMMARY_MAX_CHARS = 20

const AUTHORED_FALLBACK: Record<PortfolioInsightTag, string> = {
  'RECURRING ISSUES': 'Repeat issues',
  RISK: 'Most requests',
  'PREVENT FUTURE REPAIRS': 'Prevent repairs',
  'VENDOR RESPONSE': 'Slow vendor replies',
}

function cleanPhrase(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/g, '').trim()
}

function isInventedUnitAddress(value: string): boolean {
  const key = value.trim().toLowerCase().replace(/^unit\s+/, '')
  return key === '1' || key === 'home' || key === 'this property'
}

/** Address and phrase on one line. The phrase stays within its own 20-character limit. */
export function insightCardHeadline(building: string | null | undefined, summary: string): string {
  const address = insightCardAddressLine(building)
  if (!address) return summary
  return `${address} · ${summary}`
}

/** Property address for the card. Invented single-family units are omitted. */
export function insightCardAddressLine(building?: string | null): string {
  const place = (building ?? '').trim()
  if (!place || isInventedUnitAddress(place)) return ''
  return place
}

/**
 * Accept a summary only when the whole phrase already fits.
 * Longer text is not shortened, so a word is never cut mid-sentence.
 */
export function acceptInsightCardSummary(value: string | null | undefined): string | null {
  const phrase = cleanPhrase(value)
  if (!phrase || phrase.length > INSIGHT_CARD_SUMMARY_MAX_CHARS) return null
  if (phrase.includes('\n')) return null
  return phrase
}

export function authoredInsightSummary(input: {
  tag: PortfolioInsightTag | string
  categoryLabel?: string | null
}): string {
  const trade = cleanPhrase(input.categoryLabel).toLowerCase()
  if (input.tag === 'RECURRING ISSUES' && trade) {
    const phrase = `Repeat ${trade}`
    if (phrase.length <= INSIGHT_CARD_SUMMARY_MAX_CHARS) {
      return `Repeat ${trade}`
    }
  }
  if (input.tag === 'PREVENT FUTURE REPAIRS' && trade) {
    const phrase = `Check ${trade}`
    if (phrase.length <= INSIGHT_CARD_SUMMARY_MAX_CHARS) return phrase
  }
  const known = AUTHORED_FALLBACK[input.tag as PortfolioInsightTag]
  return known ?? 'Review this'
}

export function resolveInsightCardSummary(input: {
  summary?: string | null
  tag: PortfolioInsightTag | string
  categoryLabel?: string | null
}): string {
  return acceptInsightCardSummary(input.summary) ?? authoredInsightSummary(input)
}
