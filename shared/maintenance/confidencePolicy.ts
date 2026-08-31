/**
 * HIGH / MEDIUM / LOW classification confidence.
 * LOW is the only band that asks a clarification and blocks a job record.
 */
import type { EmergencyType } from './classificationTypes.ts'
import type { UrgencyBand } from './urgencyPolicy.ts'
import type { VendorTrade } from './vendorTradeDefinitions.ts'

export const CONFIDENCE_BANDS = ['high', 'medium', 'low'] as const
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number]

export const CONFIDENCE_NUMERIC: Record<ConfidenceBand, number> = {
  high: 0.9,
  medium: 0.68,
  low: 0.32,
}

const LOW_EXACT = new Set([
  'something is wrong',
  "something's wrong",
  'something is broken',
  "something's broken",
  'its broken',
  "it's broken",
  'it is broken',
  'please help',
  'help',
  'help me',
  'i need help',
  'the apartment has a problem',
  'my apartment has a problem',
  'the unit has a problem',
  'can you send someone',
  'send someone',
  'send somebody',
  'there is a problem',
  "there's a problem",
  'there is a weird problem',
  'there is a weird problem in my room',
  "there's a weird problem",
  "there's a weird problem in my room",
  'broken',
  'issue',
  'problem',
  'maintenance',
  'fix it',
  'fix this',
  'need a repair',
])

const TRADE_OR_SYMPTOM_RE =
  /\b(leak|leaking|leaky|drip|faucet|sink|toilet|pipe|drain|flood|pressure|outlet|spark|electric|fuse|heat|hvac|ac|cool|airflow|furnace|fridge|washer|appliance|pest|mouse|roach|cockroach|lock|roof|ceiling|crack|sagging|hole|gas|smoke|fire)\b/i

function haystack(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when the message is too vague to classify (no trade/symptom). */
export function isLowConfidenceDescription(text: string): boolean {
  const t = haystack(text)
  if (!t) return true
  if (TRADE_OR_SYMPTOM_RE.test(t)) return false
  if (LOW_EXACT.has(t)) return true
  if (
    /^(please\s+)?(help|fix|send)\b/.test(t) &&
    t.split(' ').length <= 8 &&
    !TRADE_OR_SYMPTOM_RE.test(t)
  ) {
    return true
  }
  if (
    /\b(something is (wrong|broken)|apartment has a problem|can you send)\b/.test(t) &&
    !TRADE_OR_SYMPTOM_RE.test(t)
  ) {
    return true
  }
  return false
}

export const LOW_CONFIDENCE_CLARIFICATION = {
  field: 'general',
  reason: 'low_confidence',
  question:
    "Thanks for reaching out. Could you tell me what's going on — for example a leak, no heat, something electrical, or another problem — and which room it's in?",
}

export type ConfidencePolicyInput = {
  text: string
  vendorTrade: VendorTrade | string | null | undefined
  urgencyBand: UrgencyBand
  urgencyReason: string
  emergencyType?: EmergencyType | string | null
  ruleWeight?: number
  ambiguityConfidence?: number
}

export type ConfidencePolicyResult = {
  band: ConfidenceBand
  classificationConfidence: number
  clarificationNeeded: boolean
}

function hasSpecificTrade(trade: string | null | undefined): boolean {
  const t = (trade ?? '').toLowerCase()
  return Boolean(t) && t !== 'other' && t !== 'general'
}

function hasUrgencySignal(input: ConfidencePolicyInput): boolean {
  const emergency = String(input.emergencyType ?? 'none').toLowerCase()
  if (emergency && emergency !== 'none') return true
  if (input.urgencyBand === 'emergency' || input.urgencyBand === 'low') return true
  const reason = input.urgencyReason.toLowerCase()
  if (!reason) return false
  if (reason.includes('default to a 48-hour')) return false
  return true
}

export function resolveConfidenceBand(input: ConfidencePolicyInput): ConfidencePolicyResult {
  const emergency = String(input.emergencyType ?? 'none').toLowerCase()
  if (emergency === 'gas' || emergency === 'fire') {
    return {
      band: 'high',
      classificationConfidence: CONFIDENCE_NUMERIC.high,
      clarificationNeeded: false,
    }
  }

  const vague = isLowConfidenceDescription(input.text)
  const tradeOk = hasSpecificTrade(input.vendorTrade)
  const ruleWeight = input.ruleWeight ?? 0
  const amb = input.ambiguityConfidence ?? 0
  const urgency = hasUrgencySignal(input)
  // Best-judgment overlap (ceiling leak, unnamed heat) stays MEDIUM even if
  // keywords also match a trade. HIGH needs an unambiguous fixture/named-system
  // resolution, or a strong rule with no overlap layer.
  const clearTrade =
    tradeOk &&
    (amb >= 0.84 || (ruleWeight >= 0.8 && amb === 0))

  if (vague && !tradeOk && ruleWeight < 0.7) {
    return {
      band: 'low',
      classificationConfidence: CONFIDENCE_NUMERIC.low,
      clarificationNeeded: true,
    }
  }

  if (clearTrade && urgency) {
    return {
      band: 'high',
      classificationConfidence: CONFIDENCE_NUMERIC.high,
      clarificationNeeded: false,
    }
  }

  if (tradeOk || ruleWeight >= 0.7) {
    return {
      band: 'medium',
      classificationConfidence: CONFIDENCE_NUMERIC.medium,
      clarificationNeeded: false,
    }
  }

  if (vague) {
    return {
      band: 'low',
      classificationConfidence: CONFIDENCE_NUMERIC.low,
      clarificationNeeded: true,
    }
  }

  return {
    band: 'medium',
    classificationConfidence: CONFIDENCE_NUMERIC.medium,
    clarificationNeeded: false,
  }
}
