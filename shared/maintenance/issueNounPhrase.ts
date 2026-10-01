/**
 * Short noun-phrase issue extraction from tenant free text.
 * Used by admin Messages summary and SMS intake confirmations — one implementation.
 */
import {
  hasProblemSignal,
  inferTradeFromText,
  matchDeterministicRules,
  matchesWaterOutage,
  type RuleHit,
} from './deterministicRules.ts'
import { primaryCategoryFromTrade } from './primaryCategories.ts'
import type { VendorTrade } from './classificationTypes.ts'

const GREETING_LEAD =
  /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening))(?:\s*[!,.]|\s+)+/i
const THANKS_LEAD =
  /^(?:and\s+)?(?:thank(?:s|\s+you)|thx|ty)(?:\s*[!,.]|\s+)+/i
const HEDGE_LEAD =
  /^(?:i\s+was\s+trying\s+to\s+see\s+if|i\s+(?:was\s+)?wondering\s+(?:if|whether)|i\s+(?:just\s+)?wanted\s+to\s+(?:see|ask|know|check)(?:\s+if)?|just\s+wanted\s+to\s+(?:see|ask|know|check)(?:\s+if)?|could\s+you(?:\s+please)?|can\s+you(?:\s+please)?|please|i\s+need(?:ed)?(?:\s+to)?|we\s+need(?:ed)?(?:\s+to)?)\s+/i

const FALLBACK_MAX_WORDS = 15

export type IssueNounPhraseExtraction = {
  phrase: string
  confidence: 'high' | 'low'
}

/** @deprecated Prefer IssueNounPhraseExtraction — kept for admin import sites. */
export type AdminIssueExtraction = IssueNounPhraseExtraction

/** Strip greetings, thanks, and hedging so classification sees the ask. */
export function stripTenantMessageFiller(text: string): string {
  let t = text.trim().replace(/\s+/g, ' ')
  for (let i = 0; i < 4; i += 1) {
    const next = t
      .replace(GREETING_LEAD, '')
      .replace(THANKS_LEAD, '')
      .replace(HEDGE_LEAD, '')
      .trim()
    if (next === t) break
    t = next
  }
  return t
}

function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return words.join(' ')
  return `${words.slice(0, maxWords).join(' ')}…`
}

export function containsGreetingOrPleasantry(text: string): boolean {
  return (
    /\b(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|thank(?:s|\s+you)|thx)\b/i.test(
      text,
    ) ||
    /\bi was trying to see if\b/i.test(text) ||
    /\bi was wondering\b/i.test(text)
  )
}

/** Symptom-specific noun phrases before generic trade labels. */
function specificIssueNounPhrase(hay: string): string | null {
  if (/\bno\s*heat(?:ing)?\b|\bheat\s+(?:is\s+)?(?:out|off|broken)\b/i.test(hay)) {
    return 'no heat'
  }
  if (/\bno\s*hot\s*water\b/i.test(hay)) return 'no hot water'
  if (matchesWaterOutage(hay)) return 'no water'
  if (/\bno\s*(?:ac|air\s*condition(?:ing|er)?|cooling)\b|\bac\s+(?:is\s+)?(?:out|broken|not\s+working)\b/i.test(hay)) {
    return 'no AC'
  }
  if (/\bkitchen\s+sink\b/i.test(hay) && /\bleak|leaking|drip/i.test(hay)) {
    return 'a kitchen sink leak'
  }
  if (/\bbathroom\s+sink\b/i.test(hay) && /\bleak|leaking|drip/i.test(hay)) {
    return 'a bathroom sink leak'
  }
  if (/\btoilet\b/i.test(hay) && /\b(?:overflow|clog|running|leak|broken)/i.test(hay)) {
    return 'a toilet issue'
  }
  if (/\boutlet\b/i.test(hay) && /\bspark/i.test(hay)) return 'a sparking outlet'
  if (/\blocked\s*out\b/i.test(hay)) return 'a lockout'
  if (
    /\bexterminator\b/i.test(hay) ||
    /\bspray(?:ing)?\s+(?:the\s+)?(?:property|unit|apartment|building|home)\b/i.test(hay) ||
    /\bpest\s+control\b/i.test(hay)
  ) {
    return 'a pest control request'
  }
  if (/\broach(?:es)?|cockroach|mice|mouse|rat(?:s)?|bed\s*bug/i.test(hay)) {
    return 'a pest issue'
  }
  if (/\bgas\s*(?:smell|leak)\b|\bsmell(?:s)?\s+(?:of\s+)?gas\b/i.test(hay)) {
    return 'a gas smell'
  }
  if (
    /\bdryer\b/i.test(hay) &&
    /\b(?:caught\s+(?:on\s+)?fire|catch(?:ing)?\s+fire|on\s+fire|fire)\b/i.test(hay)
  ) {
    return 'a dryer that caught fire'
  }
  if (/\b(?:caught\s+(?:on\s+)?fire|catch(?:ing)?\s+fire|on\s+fire)\b/i.test(hay)) {
    return 'a fire hazard'
  }
  return null
}

function tradeNounPhrase(trade: VendorTrade, hay: string, hit: RuleHit | null): string {
  switch (trade) {
    case 'pest_control':
      return 'a pest control request'
    case 'plumbing':
      if (hit?.issueType === 'leak' || /\bleak|drip|flood/i.test(hay)) return 'a plumbing leak'
      return 'a plumbing issue'
    case 'hvac':
      if (/\bac\b|cool|air\s*condition/i.test(hay)) return 'an AC issue'
      return 'an HVAC issue'
    case 'electrical':
      return 'an electrical issue'
    case 'appliance_repair':
      return 'an appliance issue'
    case 'locksmith':
      return 'a lock issue'
    case 'roofing':
      return 'a roofing issue'
    case 'carpentry':
      return 'a carpentry issue'
    default: {
      const bucket = primaryCategoryFromTrade(trade)
      if (bucket === 'general') return 'a maintenance issue'
      return `a ${bucket} issue`
    }
  }
}

function categoryFallbackPhrase(ticketCategory: string): string | null {
  const raw = ticketCategory.trim().toLowerCase()
  if (!raw) return null
  if (/pest/.test(raw)) return 'a pest control request'
  if (/plumb|leak/.test(raw)) return 'a plumbing issue'
  if (/hvac|heat|ac/.test(raw)) return 'an HVAC issue'
  if (/electr/.test(raw)) return 'an electrical issue'
  if (/appliance/.test(raw)) return 'an appliance issue'
  if (/lock/.test(raw)) return 'a lock issue'
  return `a ${raw.replace(/_/g, ' ')} issue`
}

/**
 * Extract a short noun-phrase issue from tenant free text using shared rules.
 * High confidence → classified phrase; low → truncated cleaned text.
 */
export function extractIssueNounPhrase(
  text: string,
  ticketCategory?: string | null,
): IssueNounPhraseExtraction {
  const raw = text.trim()
  if (!raw) {
    const fromCategory = ticketCategory ? categoryFallbackPhrase(ticketCategory) : null
    return {
      phrase: fromCategory ?? 'a maintenance issue',
      confidence: fromCategory ? 'high' : 'low',
    }
  }

  const cleaned = stripTenantMessageFiller(raw)
  const hay = (cleaned || raw).toLowerCase()

  const specific = specificIssueNounPhrase(hay)
  if (specific) return { phrase: specific, confidence: 'high' }

  const hits = matchDeterministicRules(cleaned || raw)
  const top = hits[0] ?? null
  if (top && top.weight >= 0.7) {
    return {
      phrase: tradeNounPhrase(top.trade, hay, top),
      confidence: 'high',
    }
  }

  const inferred = inferTradeFromText(cleaned || raw)
  if (inferred) {
    return {
      phrase: tradeNounPhrase(inferred, hay, null),
      confidence: 'high',
    }
  }

  const fromCategory = ticketCategory ? categoryFallbackPhrase(ticketCategory) : null
  if (fromCategory) return { phrase: fromCategory, confidence: 'high' }

  if (hasProblemSignal(cleaned || raw)) {
    return {
      phrase: truncateWords(cleaned || raw, FALLBACK_MAX_WORDS).toLowerCase(),
      confidence: 'low',
    }
  }

  return {
    phrase: truncateWords(cleaned || raw, FALLBACK_MAX_WORDS),
    confidence: 'low',
  }
}

/** Alias kept for admin Messages callers. */
export const extractAdminIssueNounPhrase = extractIssueNounPhrase
