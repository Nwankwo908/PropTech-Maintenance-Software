import { describe, expect, it } from 'vitest'
import type { ClassificationResult } from '@shared/maintenance/classificationTypes.ts'
import {
  parseLandlordTriageJson,
  toLandlordTriage,
  validateLandlordTriage,
  type LandlordTriage,
} from '@shared/maintenance/landlordTriage.ts'
import { matchingTradeForVendorSearch } from '@shared/maintenance/vendorTrades.ts'
import { PIPELINE_VERSION } from '@shared/maintenance/classificationTypes.ts'

function baseResult(over: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    pipelineVersion: PIPELINE_VERSION,
    rawDescription: 'Leaky faucet',
    sanitizedDescription: 'Leaky faucet',
    entities: {
      issueType: 'plumbing',
      vendorTrade: 'plumbing',
      affectedObject: 'faucet',
      location: 'kitchen',
      propertyHint: null,
      buildingHint: null,
      unitHint: null,
      severityIndicators: [],
      safetyRisks: [],
      activeDamage: false,
      damageType: null,
      duration: null,
      recurring: false,
      accessConstraints: null,
      residentAvailability: null,
      photoMentioned: false,
      missingInfo: [],
      emergencyType: 'none',
    },
    ticketCategory: 'plumbing',
    issueType: 'plumbing',
    vendorTrade: 'plumbing',
    primaryCategory: 'plumbing',
    secondaryTrade: null,
    classificationReason: 'Matched deterministic plumbing signals (faucet)',
    severity: 'normal',
    urgencyBand: 'medium',
    urgencyReason: 'Dripping faucet or similar minor plumbing — respond within 48 hours.',
    slaMinutes: 2880,
    photoRequested: false,
    photoRequestReason: 'Skip photos for a dripping faucet.',
    confidenceBand: 'high',
    emergencyType: 'none',
    classificationConfidence: 0.9,
    categoryConfidence: 0.9,
    tradeConfidence: 0.9,
    severityConfidence: 0.9,
    matchedKeywords: ['faucet'],
    matchedEntities: ['kitchen', 'faucet'],
    semanticMatches: [],
    modelReasoningSummary: 'Matched deterministic plumbing signals (faucet)',
    clarificationRequired: false,
    clarification: null,
    otherPostcheckRan: false,
    otherPostcheckPassed: false,
    signals: [],
    audit: {},
    ...over,
  }
}

describe('landlord triage envelope', () => {
  it('maps operational fields without changing vendor matching inputs', () => {
    const operational = baseResult({
      rawDescription: 'There is a hole in my bedroom wall',
      sanitizedDescription: 'There is a hole in my bedroom wall',
      vendorTrade: 'carpentry',
      ticketCategory: 'carpentry',
      primaryCategory: 'structural',
      secondaryTrade: null,
      issueType: 'general',
      classificationReason: 'Hole in a wall — carpentry',
      confidenceBand: 'medium',
      urgencyBand: 'medium',
      matchedKeywords: ['hole'],
      entities: {
        ...baseResult().entities,
        location: 'bedroom',
        affectedObject: null,
        vendorTrade: 'carpentry',
        issueType: 'general',
      },
    })
    const beforeTrade = operational.vendorTrade
    const beforeUrgency = operational.urgencyBand
    const view = toLandlordTriage(operational)

    expect(view.trade).toBe('STRUCTURAL')
    expect(view.urgency).toBe('MEDIUM')
    expect(view.confidence).toBe('MEDIUM')
    expect(view.clarification_needed).toBe(false)
    expect(view.clarification_question).toBeNull()
    expect(view.gas_suspected).toBe(false)
    expect(view.summary.length).toBeLessThanOrEqual(100)
    expect(view.summary).not.toMatch(/likely|keyword|classif/i)
    expect(view.summary.toLowerCase()).toMatch(/hole/)

    expect(operational.vendorTrade).toBe(beforeTrade)
    expect(operational.urgencyBand).toBe(beforeUrgency)
    expect(matchingTradeForVendorSearch(view.trade)).toBe('general')
    expect(matchingTradeForVendorSearch(operational.vendorTrade)).toBe('carpentry')
  })

  it('always emits urgency on LOW and requires a clarification question', () => {
    const view = toLandlordTriage(
      baseResult({
        rawDescription: 'Something is broken',
        sanitizedDescription: 'Something is broken',
        vendorTrade: 'other',
        primaryCategory: 'general',
        confidenceBand: 'low',
        clarificationRequired: true,
        clarification: {
          field: 'general',
          reason: 'low_confidence',
          question: 'Could you tell me what is going on and which room it is in?',
        },
        urgencyBand: 'medium',
        photoRequested: false,
      }),
    )
    expect(view.confidence).toBe('LOW')
    expect(view.clarification_needed).toBe(true)
    expect(view.clarification_question).toMatch(/\?/)
    expect(view.urgency).toBe('MEDIUM')
    expect(view.trade).toBe('GENERAL')
  })

  it('sets gas_suspected only from emergencyType and forces EMERGENCY', () => {
    const view = toLandlordTriage(
      baseResult({
        emergencyType: 'gas',
        urgencyBand: 'medium',
        confidenceBand: 'high',
        clarificationRequired: false,
      }),
    )
    expect(view.gas_suspected).toBe(true)
    expect(view.urgency).toBe('EMERGENCY')
  })

  it('rejects inconsistent landlord JSON', () => {
    const valid: LandlordTriage = {
      trade: 'PLUMBING',
      urgency: 'MEDIUM',
      summary: 'Dripping kitchen faucet',
      photo_requested: false,
      confidence: 'HIGH',
      clarification_needed: false,
      clarification_question: null,
      gas_suspected: false,
      keywords_matched: ['faucet'],
    }
    expect(validateLandlordTriage(valid).trade).toBe('PLUMBING')

    expect(() =>
      validateLandlordTriage({
        ...valid,
        confidence: 'LOW',
        clarification_needed: false,
      }),
    ).toThrow(/LOW_REQUIRES_CLARIFICATION/)

    expect(() =>
      validateLandlordTriage({
        ...valid,
        gas_suspected: true,
        urgency: 'MEDIUM',
      }),
    ).toThrow(/GAS_REQUIRES_EMERGENCY/)

    expect(() =>
      parseLandlordTriageJson('not json'),
    ).toThrow(/TRIAGE_PARSE_FAIL/)
  })
})
