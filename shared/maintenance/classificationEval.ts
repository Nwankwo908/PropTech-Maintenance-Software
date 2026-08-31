/**
 * Operational classification eval: score ClassificationResult after policies,
 * not landlord JSON from the LLM.
 */
import type { EmergencyType, VendorTrade } from './classificationTypes.ts'
import type { PrimaryCategory } from './primaryCategories.ts'
import type { UrgencyBand } from './urgencyPolicy.ts'
import type { ConfidenceBand } from './confidencePolicy.ts'
import type { ClassificationResult } from './classificationTypes.ts'
import type { LandlordTriage } from './landlordTriage.ts'

export type ClassificationEvalContext = {
  outdoorTempF?: number | null
  durationHours?: number | null
}

export type ClassificationEvalExpected = {
  vendorTrade: VendorTrade
  urgencyBand: UrgencyBand
  clarificationRequired: boolean
  primaryCategory: PrimaryCategory
  confidenceBand?: ConfidenceBand
  emergencyType?: EmergencyType
}

export type ClassificationEvalCase = {
  id: string
  input: string
  context?: ClassificationEvalContext
  expected: ClassificationEvalExpected
  /**
   * Misses on urgency/emergencyType for these cases are safety-critical.
   * Landlord-category misses never are.
   */
  safetyCritical?: boolean
}

export type ClassificationEvalDimensions = {
  vendorTrade: boolean
  urgency: boolean
  clarification: boolean
  landlordCategory: boolean
}

export type ClassificationEvalCaseResult = {
  id: string
  input: string
  dimensions: ClassificationEvalDimensions
  safetyFail: boolean
  overall: boolean
  expected: ClassificationEvalExpected
  got: {
    vendorTrade: VendorTrade
    urgencyBand: UrgencyBand
    confidenceBand: ConfidenceBand
    clarificationRequired: boolean
    primaryCategory: PrimaryCategory
    emergencyType: EmergencyType
    landlordTrade: string | null
    clarificationQuestion: string | null
  }
}

const SPECIFIC_MATCHING_TRADES = new Set<VendorTrade>([
  'appliance_repair',
  'carpentry',
  'cleaning',
  'concrete',
  'deck_builder',
  'electrical',
  'flooring',
  'hvac',
  'landscaping',
  'locksmith',
  'masonry',
  'painting',
  'pest_control',
  'plumbing',
  'roofing',
  'windows',
])

function landlordTradeFromCategory(category: PrimaryCategory): string {
  return category.toUpperCase()
}

export function scoreClassificationEvalCase(
  result: ClassificationResult & { landlordTriage?: LandlordTriage },
  testCase: ClassificationEvalCase,
): ClassificationEvalCaseResult {
  const expected = testCase.expected
  const landlordTrade = result.landlordTriage?.trade ?? null

  const vendorTrade = result.vendorTrade === expected.vendorTrade
  const urgency = result.urgencyBand === expected.urgencyBand

  let clarification = result.clarificationRequired === expected.clarificationRequired
  if (expected.confidenceBand && result.confidenceBand !== expected.confidenceBand) {
    clarification = false
  }
  if (expected.clarificationRequired) {
    if (result.confidenceBand !== 'low') clarification = false
    const question =
      result.clarification?.question?.trim() ||
      result.landlordTriage?.clarification_question?.trim() ||
      ''
    if (!question.includes('?')) clarification = false
    if (SPECIFIC_MATCHING_TRADES.has(result.vendorTrade)) clarification = false
  }

  const landlordCategory =
    result.primaryCategory === expected.primaryCategory &&
    (landlordTrade == null ||
      landlordTrade === landlordTradeFromCategory(expected.primaryCategory))

  const dimensions: ClassificationEvalDimensions = {
    vendorTrade,
    urgency,
    clarification,
    landlordCategory,
  }

  const overall =
    dimensions.vendorTrade &&
    dimensions.urgency &&
    dimensions.clarification &&
    dimensions.landlordCategory

  let safetyFail = false
  if (testCase.safetyCritical) {
    if (!urgency) safetyFail = true
    if (expected.emergencyType && result.emergencyType !== expected.emergencyType) {
      safetyFail = true
    }
  }
  if (expected.emergencyType === 'gas') {
    if (result.emergencyType !== 'gas' || result.urgencyBand !== 'emergency') {
      safetyFail = true
    }
  }

  return {
    id: testCase.id,
    input: testCase.input,
    dimensions,
    safetyFail,
    overall,
    expected,
    got: {
      vendorTrade: result.vendorTrade,
      urgencyBand: result.urgencyBand,
      confidenceBand: result.confidenceBand,
      clarificationRequired: result.clarificationRequired,
      primaryCategory: result.primaryCategory,
      emergencyType: result.emergencyType,
      landlordTrade,
      clarificationQuestion:
        result.clarification?.question ??
        result.landlordTriage?.clarification_question ??
        null,
    },
  }
}

export type ClassificationEvalSummary = {
  total: number
  overallCorrect: number
  overallPct: number
  vendorTradePct: number
  urgencyPct: number
  clarificationPct: number
  landlordCategoryPct: number
  safetyFails: ClassificationEvalCaseResult[]
  misses: ClassificationEvalCaseResult[]
}

export function summarizeClassificationEval(
  results: ClassificationEvalCaseResult[],
): ClassificationEvalSummary {
  const total = results.length
  const count = (key: keyof ClassificationEvalDimensions) =>
    results.filter((r) => r.dimensions[key]).length
  const overallCorrect = results.filter((r) => r.overall).length
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100)
  return {
    total,
    overallCorrect,
    overallPct: pct(overallCorrect),
    vendorTradePct: pct(count('vendorTrade')),
    urgencyPct: pct(count('urgency')),
    clarificationPct: pct(count('clarification')),
    landlordCategoryPct: pct(count('landlordCategory')),
    safetyFails: results.filter((r) => r.safetyFail),
    misses: results.filter((r) => !r.overall),
  }
}
