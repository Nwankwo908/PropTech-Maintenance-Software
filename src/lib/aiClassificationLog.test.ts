import { describe, expect, it } from 'vitest'
import type { ClassificationResult } from '@shared/maintenance/classificationTypes.ts'
import { PIPELINE_VERSION } from '@shared/maintenance/classificationTypes.ts'
import {
  aiClassificationLogRow,
  shouldApplyTicketTradeCorrection,
} from '@shared/maintenance/aiClassificationLog.ts'
import { toLandlordTriage } from '@shared/maintenance/landlordTriage.ts'

function baseResult(over: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    pipelineVersion: PIPELINE_VERSION,
    rawDescription: 'Kitchen sink is leaking',
    sanitizedDescription: 'Kitchen sink is leaking',
    entities: {
      issueType: 'leak',
      vendorTrade: 'plumbing',
      affectedObject: 'sink',
      location: 'kitchen',
      propertyHint: null,
      buildingHint: null,
      unitHint: null,
      severityIndicators: [],
      safetyRisks: [],
      activeDamage: true,
      damageType: 'leak',
      duration: null,
      recurring: false,
      accessConstraints: null,
      residentAvailability: null,
      photoMentioned: false,
      missingInfo: [],
      emergencyType: 'none',
    },
    ticketCategory: 'plumbing',
    issueType: 'leak',
    vendorTrade: 'plumbing',
    primaryCategory: 'plumbing',
    secondaryTrade: null,
    classificationReason: 'Named plumbing fixture',
    severity: 'normal',
    urgencyBand: 'medium',
    urgencyReason: 'Active leak',
    slaMinutes: 240,
    photoRequested: true,
    photoRequestReason: 'Photo helps',
    confidenceBand: 'high',
    emergencyType: 'none',
    classificationConfidence: 0.9,
    categoryConfidence: 0.9,
    tradeConfidence: 0.9,
    severityConfidence: 0.7,
    matchedKeywords: ['leak'],
    matchedEntities: ['sink'],
    semanticMatches: [],
    modelReasoningSummary: '',
    clarificationRequired: false,
    clarification: null,
    otherPostcheckRan: false,
    otherPostcheckPassed: false,
    signals: [],
    audit: { llm_provider: 'none', llm: null },
    ...over,
  }
}

describe('aiClassificationLogRow', () => {
  it('maps operational gold from ClassificationResult, not landlord STRUCTURAL', () => {
    const result = baseResult()
    const row = aiClassificationLogRow({
      landlordId: 'll-1',
      unitId: 'unit-1',
      residentId: 'res-1',
      conversationId: 'conv-1',
      maintenanceRequestId: 'ticket-1',
      result: { ...result, landlordTriage: toLandlordTriage(result) },
    })
    expect(row.landlord_id).toBe('ll-1')
    expect(row.vendor_trade).toBe('plumbing')
    expect(row.primary_category).toBe('plumbing')
    expect(row.urgency_band).toBe('medium')
    expect(row.confidence_band).toBe('high')
    expect(row.emergency_type).toBe('none')
    expect(row.pipeline_version).toBe(PIPELINE_VERSION)
    expect(row.llm_provider).toBe('none')
    expect(row.landlord_triage?.trade).toBe('PLUMBING')
    expect(row.raw_message).toBe('Kitchen sink is leaking')
  })

  it('clips long messages and records LLM provider from audit', () => {
    const row = aiClassificationLogRow({
      landlordId: 'll-1',
      rawMessage: 'x'.repeat(9000),
      result: baseResult({
        audit: { llm_provider: 'gpt-4o-mini', llm: { vendorTrade: 'plumbing' } },
      }),
    })
    expect(row.raw_message.length).toBe(8000)
    expect(row.llm_provider).toBe('gpt-4o-mini')
    expect(row.maintenance_request_id).toBeNull()
  })
})

describe('shouldApplyTicketTradeCorrection', () => {
  it('flags when this ticket trade changes away from the prediction', () => {
    expect(
      shouldApplyTicketTradeCorrection({
        previousIssueCategory: 'plumbing',
        nextIssueCategory: 'electrical',
        predictedVendorTrade: 'plumbing',
      }),
    ).toBe(true)
  })

  it('does not flag vendor reassignment (trade column unchanged)', () => {
    expect(
      shouldApplyTicketTradeCorrection({
        previousIssueCategory: 'plumbing',
        nextIssueCategory: 'plumbing',
        predictedVendorTrade: 'plumbing',
      }),
    ).toBe(false)
  })

  it('does not flag when the new trade already matches the prediction', () => {
    expect(
      shouldApplyTicketTradeCorrection({
        previousIssueCategory: 'general',
        nextIssueCategory: 'plumbing',
        predictedVendorTrade: 'plumbing',
      }),
    ).toBe(false)
  })
})
