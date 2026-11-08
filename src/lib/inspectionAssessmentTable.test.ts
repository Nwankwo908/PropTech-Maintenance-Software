import { describe, expect, it } from 'vitest'
import type { ApplianceVisionResult } from '@/lib/vision/types'
import {
  assessmentBrandModel,
  assessmentCategoryLabel,
  assessmentConditionLabel,
  assessmentConfidencePercent,
  assessmentConfidenceReason,
  assessmentDescription,
  assessmentTableDescription,
  assessmentMadeLabel,
  assessmentMadeDisplay,
  isUnmatchedApplianceRow,
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
    expect(assessmentCategoryLabel('electrical_panel')).toBe('Electrical panel')
    expect(assessmentCategoryLabel('plumbing')).toBe('Plumbing')
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

  it('omits description text already shown in other columns', () => {
    expect(assessmentTableDescription({
      ...base,
      identifiedItem: { type: 'Water heater' },
      condition: { rating: 'fair', summary: 'Visible condition unknown. Age unknown.' },
    }, 'Water heater')).toBe('')
    expect(assessmentTableDescription({
      ...base,
      identifiedItem: { type: 'Water heater' },
      condition: { rating: 'fair', summary: 'Rust at the base. About 12 years (estimate).' },
    }, 'Water heater')).toBe('Rust at the base.')
    expect(assessmentTableDescription({
      ...base,
      identifiedItem: { type: 'Water heater' },
      condition: { rating: 'fair', summary: 'Rust at the base. Made July 2013.' },
    }, 'Water heater')).toBe('Rust at the base.')
    expect(assessmentTableDescription(base, 'Appliance')).toBe(
      'Shows signs of wear and tarnishing on the finish.',
    )
    expect(assessmentMadeLabel({ year: 2013, month: 7 })).toBe('July 2013')
    expect(assessmentMadeLabel({ year: 2013 })).toBe('2013')
    expect(assessmentMadeLabel(null)).toBe('—')
  })

  it('treats an unknown or mismatched appliance as not table-ready', () => {
    expect(isUnmatchedApplianceRow({
      categoryLabel: 'Unknown',
      result: { ...base, category: 'unknown', identifiedItem: { type: 'Unknown' } },
    })).toBe(true)
    expect(isUnmatchedApplianceRow({
      categoryLabel: 'Water heater',
      result: {
        ...base,
        category: 'water_heater',
        identifiedItem: { type: 'Water heater' },
        labelReadability: {
          status: 'uncertain',
          modelConfidence: 0,
          serialConfidence: 0,
          uncertainCharacters: [],
          formatWarnings: [],
          retakeRequested: true,
          retakeMessage: 'These photos do not match the selected system.',
        },
      },
    })).toBe(true)
    expect(isUnmatchedApplianceRow({
      categoryLabel: 'Water heater',
      result: { ...base, category: 'water_heater', identifiedItem: { type: 'Water heater' } },
    })).toBe(false)
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

it('keeps visible findings without presenting stale AI age claims as current facts',()=>{
 const result:ApplianceVisionResult={...base,manufactureDate:{year:null,month:null},estimatedAge:{value:null,confidence:'low',basis:'Unknown'},condition:{rating:'fair',summary:'Water heater appears functional with intact casing and controls, but it is past typical design life expectancy (manufactured in 2008) and lacks a drain pan.'}};
 expect(assessmentTableDescription(result,'Water heater')).toBe('Water heater appears functional with intact casing and controls. Lacks a drain pan.');
 expect(assessmentMadeLabel(result.manufactureDate)).toBe('—');
 expect(result.condition.summary).toContain('manufactured in 2008');
});
it('does not repeat a prose date that disagrees with the structured date',()=>{
 const result:ApplianceVisionResult={...base,manufactureDate:{year:2013,month:7},condition:{rating:'fair',summary:'Manufactured in 2008. Rust at the base. It is 18 years old and has a loose panel.'}};
 expect(assessmentTableDescription(result,'Heating system')).toBe('Rust at the base. Has a loose panel.');
 expect(assessmentMadeLabel(result.manufactureDate)).toBe('July 2013');
});
it('retains condition-only notes and omits descriptions containing only age claims',()=>{
 expect(assessmentTableDescription({...base,condition:{rating:'fair',summary:'The unit exceeds its useful life. Made in 2008.'}},'Appliance')).toBe('');
 expect(assessmentTableDescription({...base,condition:{rating:'poor',summary:'Rust at the base, loose casing and visible water staining.'}},'Water heater')).toBe('Rust at the base, loose casing and visible water staining.');
});

it('shows a photo-derived manufacture year with an asterisk without changing saved fields',()=>{
 const result:ApplianceVisionResult={...base,manufactureDate:{year:null,month:null},estimatedAge:{value:null,confidence:'low',basis:'Unknown'},condition:{rating:'fair',summary:'Intact casing, but past design life (manufactured in 2008) and lacks a drain pan.'}};
 expect(assessmentMadeDisplay(result)).toEqual({label:'2008*',estimated:true});
 expect(result.manufactureDate).toEqual({year:null,month:null});expect(result.estimatedAge.value).toBe(null);
 expect(assessmentTableDescription(result,'Water heater')).not.toMatch(/2008|design life/);
 expect(assessmentMadeDisplay({...result,manufactureDate:{year:2013,month:7}})).toEqual({label:'July 2013',estimated:false});
});
it('does not invent a manufacture estimate from a serial, age, conflicting years or negated reading',()=>{
 for(const summary of ['Serial 2008T422715.','About 18 years old.','Manufactured in 2008. Made in 2013.','Not manufactured in 2008.','Manufactured in 2099.']){
  expect(assessmentMadeDisplay({...base,condition:{rating:'fair',summary}})).toEqual({label:'—',estimated:false});
 }
});
