/**
 * Landlord-facing triage envelope.
 * Maps a finished ClassificationResult after Ulo policies have run.
 * Never used for vendor matching, SLA, photo, confidence, or gas detection.
 */
import { LOW_CONFIDENCE_CLARIFICATION } from './confidencePolicy.ts'
import { PRIMARY_CATEGORIES, type PrimaryCategory } from './primaryCategories.ts'
import type { ClassificationResult } from './classificationTypes.ts'

export const LANDLORD_TRIAGE_TRADES = [
  'PLUMBING',
  'HVAC',
  'ELECTRICAL',
  'APPLIANCE',
  'STRUCTURAL',
  'PEST',
  'GENERAL',
] as const

export const LANDLORD_TRIAGE_URGENCY = ['EMERGENCY', 'MEDIUM', 'LOW'] as const
export const LANDLORD_TRIAGE_CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'] as const

export type LandlordTriageTrade = (typeof LANDLORD_TRIAGE_TRADES)[number]
export type LandlordTriageUrgency = (typeof LANDLORD_TRIAGE_URGENCY)[number]
export type LandlordTriageConfidence = (typeof LANDLORD_TRIAGE_CONFIDENCE)[number]

export type LandlordTriage = {
  trade: LandlordTriageTrade
  urgency: LandlordTriageUrgency
  summary: string
  photo_requested: boolean
  confidence: LandlordTriageConfidence
  clarification_needed: boolean
  clarification_question: string | null
  gas_suspected: boolean
  keywords_matched: string[]
}

const SUMMARY_MAX = 100

const INTERNAL_SUMMARY_RE =
  /\b(likely|keyword|classif(?:y|ication)|pipeline|vendor trade|primary category|confidence band|postcheck|sla)\b/i

function asTrade(category: PrimaryCategory | string): LandlordTriageTrade {
  const raw = String(category ?? 'general').trim().toLowerCase()
  const match = PRIMARY_CATEGORIES.find((c) => c === raw)
  return (match ? match.toUpperCase() : 'GENERAL') as LandlordTriageTrade
}

function asUrgency(band: string): LandlordTriageUrgency {
  const v = String(band ?? 'medium').trim().toLowerCase()
  if (v === 'emergency') return 'EMERGENCY'
  if (v === 'low') return 'LOW'
  return 'MEDIUM'
}

function asConfidence(band: string): LandlordTriageConfidence {
  const v = String(band ?? 'medium').trim().toLowerCase()
  if (v === 'high') return 'HIGH'
  if (v === 'low') return 'LOW'
  return 'MEDIUM'
}

function truncateSummary(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= SUMMARY_MAX) return collapsed
  const sliced = collapsed.slice(0, SUMMARY_MAX)
  const lastSpace = sliced.lastIndexOf(' ')
  const cut = lastSpace >= 40 ? sliced.slice(0, lastSpace) : sliced
  return cut.trim()
}

function startWithIssue(text: string): string {
  let t = text
    .replace(/\(photo attached\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  t = t.split(/[\n.!?]/)[0]?.trim() || t
  t = t.replace(
    /^(hi|hello|hey|please|can you|could you|i have|i think|i need|we have|there(?:'s| is| are)|my)\s+/i,
    '',
  )
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Plain landlord scan line from the classified ticket — not classificationReason. */
export function buildLandlordSummary(result: ClassificationResult): string {
  const source = (result.sanitizedDescription || result.rawDescription || '').trim()
  if (result.confidenceBand === 'low' && (!source || source.split(/\s+/).length <= 4)) {
    const fromText = startWithIssue(source)
    if (!fromText || fromText.length < 8) {
      return 'Resident reported a problem without describing the issue.'
    }
  }

  let line = startWithIssue(source)
  const location = result.entities?.location?.trim()
  if (location && line && !line.toLowerCase().includes(location.toLowerCase())) {
    const next = `${line} in the ${location}`
    if (next.length <= SUMMARY_MAX) line = next
  }
  if (!line || INTERNAL_SUMMARY_RE.test(line)) {
    line = startWithIssue(source) || 'Resident reported a maintenance problem.'
  }
  return truncateSummary(line || 'Resident reported a maintenance problem.')
}

/**
 * Map operational ClassificationResult → landlord envelope.
 * Does not re-run urgency, photo, confidence, ambiguity, or matching.
 */
export function toLandlordTriage(result: ClassificationResult): LandlordTriage {
  const gas_suspected = result.emergencyType === 'gas'
  const confidence = asConfidence(result.confidenceBand)
  const clarification_needed =
    confidence === 'LOW' ? true : Boolean(result.clarificationRequired)
  let clarification_question: string | null = null
  if (clarification_needed) {
    const question = result.clarification?.question?.trim() || LOW_CONFIDENCE_CLARIFICATION.question
    clarification_question = question
  }

  const mapped: LandlordTriage = {
    trade: asTrade(result.primaryCategory),
    urgency: gas_suspected ? 'EMERGENCY' : asUrgency(result.urgencyBand),
    summary: buildLandlordSummary(result),
    photo_requested: Boolean(result.photoRequested),
    confidence,
    clarification_needed,
    clarification_question,
    gas_suspected,
    keywords_matched: Array.isArray(result.matchedKeywords)
      ? [...result.matchedKeywords]
      : [],
  }

  return validateLandlordTriage(mapped)
}

export function validateLandlordTriage(parsed: LandlordTriage): LandlordTriage {
  if (!LANDLORD_TRIAGE_TRADES.includes(parsed.trade)) {
    throw new Error(`TRIAGE_INVALID_TRADE: ${parsed.trade}`)
  }
  if (!LANDLORD_TRIAGE_URGENCY.includes(parsed.urgency)) {
    throw new Error(`TRIAGE_INVALID_URGENCY: ${parsed.urgency}`)
  }
  if (!LANDLORD_TRIAGE_CONFIDENCE.includes(parsed.confidence)) {
    throw new Error(`TRIAGE_INVALID_CONFIDENCE: ${parsed.confidence}`)
  }
  if (typeof parsed.photo_requested !== 'boolean') {
    throw new Error('TRIAGE_INVALID_PHOTO_REQUESTED')
  }
  if (typeof parsed.clarification_needed !== 'boolean') {
    throw new Error('TRIAGE_INVALID_CLARIFICATION_NEEDED')
  }
  if (!Array.isArray(parsed.keywords_matched)) {
    throw new Error('TRIAGE_INVALID_KEYWORDS')
  }
  if (typeof parsed.summary !== 'string' || parsed.summary.length === 0) {
    throw new Error('TRIAGE_INVALID_SUMMARY')
  }
  if (parsed.summary.length > SUMMARY_MAX) {
    throw new Error('TRIAGE_SUMMARY_TOO_LONG')
  }
  if (parsed.confidence === 'LOW' && parsed.clarification_needed !== true) {
    throw new Error('TRIAGE_LOW_REQUIRES_CLARIFICATION')
  }
  if (parsed.clarification_needed) {
    if (!parsed.clarification_question || !parsed.clarification_question.trim()) {
      throw new Error('TRIAGE_MISSING_CLARIFICATION_QUESTION')
    }
    if (!parsed.clarification_question.includes('?')) {
      throw new Error('TRIAGE_CLARIFICATION_NOT_A_QUESTION')
    }
  } else if (parsed.clarification_question !== null) {
    throw new Error('TRIAGE_UNEXPECTED_CLARIFICATION_QUESTION')
  }
  if (parsed.gas_suspected && parsed.urgency !== 'EMERGENCY') {
    throw new Error('TRIAGE_GAS_REQUIRES_EMERGENCY')
  }
  return parsed
}

/** Parse a model JSON string into a landlord envelope. Do not feed this into matching. */
export function parseLandlordTriageJson(raw: string): LandlordTriage {
  let parsed: unknown
  try {
    const clean = raw.replace(/```json|```/g, '').trim()
    parsed = JSON.parse(clean)
  } catch {
    throw new Error(`TRIAGE_PARSE_FAIL: ${raw.slice(0, 100)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('TRIAGE_PARSE_FAIL: not an object')
  }
  const row = parsed as Record<string, unknown>
  const required = [
    'trade',
    'urgency',
    'summary',
    'photo_requested',
    'confidence',
    'clarification_needed',
    'clarification_question',
    'gas_suspected',
    'keywords_matched',
  ]
  for (const field of required) {
    if (row[field] === undefined) {
      throw new Error(`TRIAGE_MISSING_FIELD: ${field}`)
    }
  }
  return validateLandlordTriage({
    trade: row.trade as LandlordTriageTrade,
    urgency: row.gas_suspected ? 'EMERGENCY' : (row.urgency as LandlordTriageUrgency),
    summary: String(row.summary ?? ''),
    photo_requested: row.photo_requested as boolean,
    confidence: row.confidence as LandlordTriageConfidence,
    clarification_needed: row.clarification_needed as boolean,
    clarification_question: (row.clarification_question as string | null) ?? null,
    gas_suspected: Boolean(row.gas_suspected),
    keywords_matched: row.keywords_matched as string[],
  })
}
