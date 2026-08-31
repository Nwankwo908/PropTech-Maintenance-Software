import { describe, expect, it } from 'vitest'
import type { ClassificationResult } from '@shared/maintenance/classificationTypes.ts'
import { PIPELINE_VERSION } from '@shared/maintenance/classificationTypes.ts'
import { toLandlordTriage } from '@shared/maintenance/landlordTriage.ts'
import {
  scoreClassificationEvalCase,
  summarizeClassificationEval,
} from '@shared/maintenance/classificationEval.ts'
import { matchingTradeForVendorSearch } from '@shared/maintenance/vendorTrades.ts'
import { CLASSIFICATION_EVAL_SET } from '@shared/maintenance/classificationEvalSet.ts'

function baseResult(over: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    pipelineVersion: PIPELINE_VERSION,
    rawDescription: 'Hole in the wall',
    sanitizedDescription: 'Hole in the wall',
    entities: {
      issueType: 'general',
      vendorTrade: 'carpentry',
      affectedObject: 'wall',
      location: null,
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
    ticketCategory: 'carpentry',
    issueType: 'general',
    vendorTrade: 'carpentry',
    primaryCategory: 'structural',
    secondaryTrade: null,
    classificationReason: 'Hole in wall',
    severity: 'normal',
    urgencyBand: 'medium',
    urgencyReason: 'Default 48h',
    slaMinutes: 2880,
    photoRequested: true,
    photoRequestReason: 'Photo helps',
    confidenceBand: 'high',
    emergencyType: 'none',
    classificationConfidence: 0.9,
    categoryConfidence: 0.9,
    tradeConfidence: 0.9,
    severityConfidence: 0.7,
    matchedKeywords: ['hole'],
    matchedEntities: ['wall'],
    semanticMatches: [],
    modelReasoningSummary: '',
    clarificationRequired: false,
    clarification: null,
    otherPostcheckRan: false,
    otherPostcheckPassed: false,
    signals: [],
    audit: {},
    ...over,
  }
}

describe('classification eval scorer', () => {
  it('passes hole-in-wall when matching is carpentry and landlord bucket is STRUCTURAL', () => {
    const result = baseResult()
    const scored = scoreClassificationEvalCase(
      { ...result, landlordTriage: toLandlordTriage(result) },
      {
        id: 'hole',
        input: 'Hole in the wall',
        expected: {
          vendorTrade: 'carpentry',
          urgencyBand: 'medium',
          clarificationRequired: false,
          primaryCategory: 'structural',
        },
      },
    )
    expect(scored.overall).toBe(true)
    expect(scored.got.landlordTrade).toBe('STRUCTURAL')
    expect(matchingTradeForVendorSearch(scored.got.landlordTrade ?? '')).toBe('general')
  })

  it('treats a gas urgency miss as safety-critical even if landlord category matches', () => {
    const result = baseResult({
      vendorTrade: 'other',
      primaryCategory: 'general',
      urgencyBand: 'medium',
      emergencyType: 'none',
      ticketCategory: 'other',
    })
    const scored = scoreClassificationEvalCase(
      { ...result, landlordTriage: toLandlordTriage(result) },
      {
        id: 'gas',
        input: 'I smell gas',
        safetyCritical: true,
        expected: {
          vendorTrade: 'other',
          urgencyBand: 'emergency',
          clarificationRequired: false,
          primaryCategory: 'general',
          emergencyType: 'gas',
        },
      },
    )
    expect(scored.dimensions.landlordCategory).toBe(true)
    expect(scored.dimensions.urgency).toBe(false)
    expect(scored.safetyFail).toBe(true)
    expect(scored.overall).toBe(false)
  })

  it('fails overall when only landlord category is correct', () => {
    const result = baseResult({
      vendorTrade: 'general',
      primaryCategory: 'structural',
      ticketCategory: 'general',
    })
    const scored = scoreClassificationEvalCase(
      { ...result, landlordTriage: toLandlordTriage(result) },
      {
        id: 'lock',
        input: 'The front door lock is broken',
        expected: {
          vendorTrade: 'locksmith',
          urgencyBand: 'medium',
          clarificationRequired: false,
          primaryCategory: 'structural',
        },
      },
    )
    expect(scored.dimensions.landlordCategory).toBe(true)
    expect(scored.dimensions.vendorTrade).toBe(false)
    expect(scored.overall).toBe(false)
  })

  it('requires LOW confidence and no guessed matching trade when clarification is expected', () => {
    const guessed = baseResult({
      vendorTrade: 'plumbing',
      primaryCategory: 'plumbing',
      confidenceBand: 'low',
      clarificationRequired: true,
      clarification: { question: 'What is going on?', reason: 'vague', field: 'issue' },
    })
    const scored = scoreClassificationEvalCase(
      { ...guessed, landlordTriage: toLandlordTriage(guessed) },
      {
        id: 'vague',
        input: 'Something is broken',
        expected: {
          vendorTrade: 'other',
          urgencyBand: 'medium',
          clarificationRequired: true,
          confidenceBand: 'low',
          primaryCategory: 'general',
        },
      },
    )
    expect(scored.dimensions.clarification).toBe(false)
    expect(scored.dimensions.vendorTrade).toBe(false)
  })

  it('summarizes dimensions separately', () => {
    const hole = scoreClassificationEvalCase(
      { ...baseResult(), landlordTriage: toLandlordTriage(baseResult()) },
      CLASSIFICATION_EVAL_SET.find((c) => c.id === 'hole-in-wall')!,
    )
    const summary = summarizeClassificationEval([hole])
    expect(summary.vendorTradePct).toBe(100)
    expect(summary.landlordCategoryPct).toBe(100)
    expect(summary.safetyFails).toEqual([])
  })
})
