import { insightCardAddressLine } from './insightCardSummary.ts'
import type { PortfolioInsightTag } from './types.ts'

export type InsightDetailSections = {
  mainIssue: string
  recommendedAction: string
}

const PANEL_TITLES = [
  'Recurring Issues',
  'Needs Attention',
  'Vendor Response',
  'Prevent Future Repairs',
  'Recommended action',
  'Main issue',
]

const STOP_WORDS = new Set([
  'repeated',
  'repeat',
  'issues',
  'issue',
  'requests',
  'request',
  'maintenance',
  'the',
  'and',
  'with',
  'from',
  'this',
  'that',
  'have',
  'has',
  'been',
  'keep',
  'keeps',
  'occurring',
  'occurred',
])

const ACTION_WORDS = new Set([
  'schedule',
  'inspection',
  'identify',
  'cause',
  'prevent',
  'repeat',
  'repair',
  'review',
  'follow',
  'vendor',
  'diagnostic',
  'walkthrough',
  'assign',
  'assigned',
  'open',
  'next',
  'request',
  'maintenance',
])

const RISK_CLAIM = /\b(high[\s-]?risk|dangerous|emergency|unsafe)\b/i
const RISK_EVIDENCE = /\b(high[\s-]?risk|hazard|emergency|fire|gas|spark|smoke|unsafe|carbon monoxide|danger)\b/i

function cleanSpace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function asSentence(value: string): string {
  const trimmed = cleanSpace(value).replace(/[.!?]+$/g, '').trim()
  if (!trimmed) return ''
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripPhrases(value: string, phrases: Array<string | null | undefined>): string {
  let out = cleanSpace(value)
  const sorted = phrases
    .map((phrase) => cleanSpace(phrase))
    .filter((phrase) => phrase.length > 1)
    .sort((a, b) => b.length - a.length)
  for (const phrase of sorted) {
    out = out.replace(new RegExp(escapeRegExp(phrase), 'ig'), ' ')
  }
  return cleanSpace(
    out
      .replace(/\b(in|at|for|on|about)\b\s*(?=[.,]|$)/gi, '')
      .replace(/\s+([.,])/g, '$1')
      .replace(/\(\s*\)/g, ''),
  )
}

function stems(value: string): string[] {
  return cleanSpace(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/(ing|ed|es|s)$/i, ''))
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
}

function corpusText(input: {
  categoryLabel?: string | null
  ticketSummaries?: Array<{ description?: string | null }>
}): string {
  return [input.categoryLabel, ...(input.ticketSummaries ?? []).map((ticket) => ticket.description)]
    .map((part) => cleanSpace(part))
    .filter(Boolean)
    .join(' ')
}

function riskSupported(corpus: string): boolean {
  return RISK_EVIDENCE.test(corpus)
}

function dropUnsupportedRisk(value: string, supported: boolean): string {
  if (supported || !value) return value
  return value
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !RISK_CLAIM.test(sentence))
    .join(' ')
    .trim()
}

function wordsAreGrounded(value: string, corpus: string, allowed: Set<string>): boolean {
  const haystack = new Set(stems(corpus))
  return stems(value)
    .filter((word) => !allowed.has(word))
    .every((word) => haystack.has(word))
}

function descriptions(input: {
  ticketSummaries?: Array<{ description?: string | null }>
}): string[] {
  const seen = new Set<string>()
  const list: string[] = []
  for (const ticket of input.ticketSummaries ?? []) {
    const description = cleanSpace(ticket.description)
    const key = description.toLowerCase()
    if (!description || seen.has(key)) continue
    seen.add(key)
    list.push(description)
  }
  return list
}

function groundedMainIssue(input: {
  tag?: string | null
  categoryLabel?: string | null
  ticketSummaries?: Array<{ description?: string | null }>
  aggregateText?: string | null
}): string {
  const unique = descriptions(input)
  if (input.tag === 'RISK') {
    const aggregate = asSentence(cleanSpace(input.aggregateText))
    if (aggregate && !RISK_CLAIM.test(aggregate)) return aggregate
  }
  if (input.tag === 'VENDOR RESPONSE') return 'Vendor replies are slow.'
  if (unique.length === 1) {
    const phrase = unique[0]!
    if (input.tag === 'RECURRING ISSUES' || input.tag === 'PREVENT FUTURE REPAIRS') {
      return asSentence(`Repeated ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}`)
    }
    return asSentence(phrase)
  }
  if (unique.length === 2 && unique.every((item) => item.length <= 48)) {
    const [first, second] = unique
    return asSentence(`${first} and ${second!.charAt(0).toLowerCase()}${second!.slice(1)}`)
  }
  const trade = cleanSpace(input.categoryLabel).toLowerCase()
  if (trade) return asSentence(`Repeated ${trade} requests`)
  return 'Repeated maintenance requests.'
}

function fallbackRecommendedAction(input: {
  tag?: string | null
  categoryLabel?: string | null
}): string {
  const trade = cleanSpace(input.categoryLabel).toLowerCase()
  if (input.tag === 'VENDOR RESPONSE') return 'Follow up with the assigned vendor.'
  if (input.tag === 'RISK') return 'Review these requests and schedule the next repair.'
  if (trade && (input.tag === 'RECURRING ISSUES' || input.tag === 'PREVENT FUTURE REPAIRS')) {
    if (input.tag === 'RECURRING ISSUES') {
      return `Schedule a ${trade} inspection to identify the cause and prevent repeat repairs.`
    }
    return `Schedule a ${trade} inspection.`
  }
  if (trade) return `Schedule a ${trade} inspection.`
  return 'Review the open requests.'
}

function places(input: { building?: string | null; unitLabel?: string | null }): string[] {
  const address = insightCardAddressLine(input.building)
  const rawBuilding = cleanSpace(input.building)
  const unit = cleanSpace(input.unitLabel)
  const inventedUnit = unit && insightCardAddressLine(unit) === '' ? unit : ''
  const inventedBuilding = rawBuilding && insightCardAddressLine(rawBuilding) === '' ? rawBuilding : ''
  return [address, address ? rawBuilding : '', inventedUnit, inventedBuilding, 'this property'].filter(
    (place, index, all) => Boolean(place) && place.length > 1 && all.indexOf(place) === index,
  )
}

function prepare(value: string | null | undefined, input: {
  title?: string | null
  building?: string | null
  unitLabel?: string | null
  supported: boolean
}): string {
  const stripped = stripPhrases(dropUnsupportedRisk(cleanSpace(value), input.supported), [
    input.title,
    ...PANEL_TITLES,
    ...places(input),
  ])
  return asSentence(stripped)
}

function sameSentence(left: string, right: string): boolean {
  return cleanSpace(left).replace(/[.!?]+$/g, '').toLowerCase() === cleanSpace(right).replace(/[.!?]+$/g, '').toLowerCase()
}

export function insightDetailSections(input: {
  title?: string | null
  building?: string | null
  unitLabel?: string | null
  categoryLabel?: string | null
  tag?: PortfolioInsightTag | string | null
  text?: string | null
  aggregateText?: string | null
  mainIssue?: string | null
  ticketSummaries?: Array<{ description?: string | null }>
}): InsightDetailSections {
  const corpus = corpusText(input)
  const supported = riskSupported(corpus)
  const fallbackIssue = groundedMainIssue(input)
  const fallbackAction = fallbackRecommendedAction(input)
  const candidateIssue = prepare(input.mainIssue, { ...input, supported })
  const mainIssue =
    candidateIssue && wordsAreGrounded(candidateIssue, corpus, new Set())
      ? candidateIssue
      : fallbackIssue

  const aggregate = prepare(input.aggregateText, { ...input, supported })
  const candidateAction = prepare(input.text, { ...input, supported })
  const actionIsAggregate = candidateAction && aggregate && sameSentence(candidateAction, aggregate)
  const recommendedAction =
    candidateAction &&
    !actionIsAggregate &&
    !sameSentence(candidateAction, mainIssue) &&
    wordsAreGrounded(candidateAction, corpus, ACTION_WORDS)
      ? candidateAction
      : fallbackAction

  return { mainIssue, recommendedAction }
}

/** Drop the header address and invented unit labels from a work-order context line. */
export function insightDetailWorkOrderContext(
  context: string | null | undefined,
  building: string | null | undefined,
): string | null {
  const address = insightCardAddressLine(building)
  const parts = cleanSpace(context)
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      if (address && part.toLowerCase() === address.toLowerCase()) return false
      if (insightCardAddressLine(part) === '') return false
      return true
    })
  return parts.join(' · ') || null
}
