import { describe, expect, it } from 'vitest'
import type { ApplianceVisionResult } from '@/lib/vision/types'
import {
  assessmentBrandModel,
  assessmentCategoryLabel,
  assessmentConditionLabel,
  assessmentConfidencePercent,
  assessmentConfidenceReason,
  assessmentDescription,
  assessmentSerial,
  assessmentActionLabel,
  parseBrandModelField,
  visionResultFromSavedInspectionAsset,
  visionResultsFromInspectionPhoto,
} from '@/lib/inspectionAssessmentTable'

const base: ApplianceVisionResult = {
  category: 'appliance',
  identifiedItem: { type: 'Dishwasher' },
  estimatedAge: { value: 8, confidence: 'medium', basis: 'wear' },
  condition: { rating: 'fair', summary: 'Shows signs of wear and tarnishing on the finish.' },
  deficiencies: [],
  maintenanceRecommendations: [],
}

describe('inspectionAssessmentTable', () => {
  it('labels category and condition like the review table', () => {
    expect(assessmentCategoryLabel('appliance')).toBe('Appliance')
    expect(assessmentCategoryLabel('water_heater')).toBe('Water heater')
    expect(assessmentConditionLabel('good')).toBe('Good')
    expect(assessmentConditionLabel('fair')).toBe('Fair')
  })

  it('formats brand / model with Unknown / - when missing', () => {
    expect(assessmentBrandModel(base)).toBe('Unknown / -')
    expect(
      assessmentBrandModel({
        ...base,
        identifiedItem: { type: 'Faucet', brand: 'Grohe', modelNumber: 'Essence' },
      }),
    ).toBe('Grohe / Essence')
  })

  it('uses condition summary as description', () => {
    expect(assessmentDescription(base)).toBe('Shows signs of wear and tarnishing on the finish.')
    expect(
      assessmentDescription({
        ...base,
        condition: { rating: 'good', summary: '  ' },
      }),
    ).toBe('Dishwasher')
  })

  it('treats blank serial as missing', () => {
    expect(assessmentSerial(base)).toBe('')
    expect(
      assessmentSerial({
        ...base,
        identifiedItem: { type: 'Valve', serialNumber: 'GR-88214' },
      }),
    ).toBe('GR-88214')
  })

  it('parses brand / model cell edits', () => {
    expect(parseBrandModelField('Grohe / Essence')).toEqual({
      brand: 'Grohe',
      modelNumber: 'Essence',
    })
    expect(parseBrandModelField('Bosch')).toEqual({ brand: 'Bosch', modelNumber: '' })
  })

  it('shows confidence percent and reason notes', () => {
    expect(assessmentConfidencePercent(base)).toBe(65)
    expect(assessmentConfidenceReason(base)).toBe('wear')
    expect(
      assessmentConfidencePercent({
        ...base,
        overallConfidence: 38,
        rawConfidenceNotes: "The faucet's age and brand are not identifiable from the image.",
      }),
    ).toBe(38)
    expect(
      assessmentConfidenceReason({
        ...base,
        rawConfidenceNotes: "The faucet's age and brand are not identifiable from the image.",
      }),
    ).toBe("The faucet's age and brand are not identifiable from the image.")
  })

  it('picks the highest-priority deficiency action', () => {
    expect(assessmentActionLabel(base)).toBe('Monitor')
    expect(
      assessmentActionLabel({
        ...base,
        deficiencies: [
          { description: 'Chip', severity: 'cosmetic' },
          { description: 'Leak', severity: 'repair_recommended' },
        ],
      }),
    ).toBe('Repair recommended')
    expect(
      assessmentActionLabel({
        ...base,
        deficiencies: [{ description: 'Exposed wiring', severity: 'safety_hazard' }],
      }),
    ).toBe('Safety hazard')
  })

  it('rebuilds a table result from a saved unit asset', () => {
    expect(
      visionResultFromSavedInspectionAsset({
        appliance_type: 'Water heater',
        brand: 'Rheem',
        model: 'XE50',
        metadata: {
          conditionRating: 'good',
          conditionSummary: 'Tank looks clean.',
          serialNumber: 'RH-1',
          category: 'water_heater',
        },
      }).identifiedItem,
    ).toEqual({
      type: 'Water heater',
      brand: 'Rheem',
      modelNumber: 'XE50',
      serialNumber: 'RH-1',
    })
  })

  it('keeps every extracted item from a document photo', () => {
    const fridge = { ...base, identifiedItem: { type: 'Refrigerator', brand: 'GE' } }
    const stove = { ...base, identifiedItem: { type: 'Range', brand: 'Bosch' } }
    expect(
      visionResultsFromInspectionPhoto({
        aiResult: { ...fridge, _extractedItems: [fridge, stove] } as typeof fridge,
      }).map((row) => row.identifiedItem.type),
    ).toEqual(['Refrigerator', 'Range'])
  })
})
