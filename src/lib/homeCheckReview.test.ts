import { describe, expect, it } from 'vitest'
import type { HomeCheckAsset } from '@shared/homeCheck'
import {
  homeCheckConfidenceNote,
  homeCheckLabelCorrection,
  homeCheckManufactureLabel,
  homeCheckReviewLabels,
  homeCheckReviewResult,
} from './homeCheckReview'

function field(
  value: string | number | null,
  confidence: 'low' | 'medium' | 'high' = 'low',
): HomeCheckAsset['fields']['make'] {
  return {
    value,
    source: 'photo_text',
    capturedBy: 'tenant',
    confidence,
    photoIds: [],
  }
}

function asset(overrides: Partial<HomeCheckAsset> = {}): HomeCheckAsset {
  return {
    system: 'water_heater',
    verified: false,
    fields: {
      make: field(null),
      model: field(null),
      serial: field(null),
      approximateAge: {
        ...field(null),
        basis: 'Label unreadable or manufacture date unknown',
      },
      condition: field(null),
      lastService: field(null),
      lastFilterChange: field(null),
    },
    ...overrides,
  }
}

describe('home check review mapping', () => {
  it('keeps unknown plate text unknown and puts confidence in one note', () => {
    const row = asset()
    const result = homeCheckReviewResult(row)
    const note = homeCheckConfidenceNote(row)
    expect(result.identifiedItem.brand).toBeUndefined()
    expect(result.identifiedItem.modelNumber).toBeUndefined()
    expect(result.identifiedItem.serialNumber).toBeUndefined()
    expect(result.overallConfidence).toBe(40)
    expect(note).toMatch(/unknown until the label can be read/i)
    expect(note.match(/confidence/gi)?.length ?? 0).toBe(0)
    expect(homeCheckReviewLabels(row)).toMatchObject({
      categoryLabel: 'Water heater',
      conditionLabel: 'Unknown',
      actionLabel: 'Unverified',
      manufactureLabel: 'Manufacture date unknown',
    })
  })

  it('carries a corrected manufacture date and plate text into the review row', () => {
    const row = asset({
      verified: true,
      manufactureDate: { year: 2013, month: 7 },
      fields: {
        ...asset().fields,
        make: field('Rheem', 'high'),
        model: field('XE40', 'high'),
        serial: field('AB01234', 'medium'),
        approximateAge: { ...field(12, 'medium'), basis: 'Calculated from the manufacture date.' },
        condition: field('fair: Rust at the base'),
      },
    })
    const result = homeCheckReviewResult(row, {
      modelNumber: 'XE40',
      serialNumber: 'AB01234',
      manufactureMonth: '7',
      manufactureYear: '2013',
    })
    expect(result.identifiedItem).toMatchObject({
      brand: 'Rheem',
      modelNumber: 'XE40',
      serialNumber: 'AB01234',
    })
    expect(result.manufactureDate).toEqual({ year: 2013, month: 7 })
    expect(result.condition.summary).toMatch(/Rust at the base/)
    expect(result.condition.summary).toContain(`About ${new Date().getUTCFullYear()-2013} years`)
    expect(homeCheckReviewLabels(row).conditionLabel).toBe('Fair')
    expect(homeCheckReviewLabels(row).actionLabel).toBe('Details verified')
    expect(homeCheckManufactureLabel(row.manufactureDate)).toBe('Made July 2013')
    expect(homeCheckConfidenceNote(row)).toMatch(/Read from the photo/)
    expect(homeCheckConfidenceNote(row)).toMatch(/Medium confidence/)
    expect(homeCheckConfidenceNote(row).match(/confidence/gi)?.length).toBe(1)
  })

  it('sends manufacture month and year only when they were entered', () => {
    expect(homeCheckLabelCorrection('asset-0', {
      modelNumber: 'XE40',
      serialNumber: 'AB01234',
      manufactureMonth: '',
      manufactureYear: '',
    })).toEqual({
      assetId: 'asset-0',
      modelNumber: 'XE40',
      serialNumber: 'AB01234',
    })
    expect(homeCheckLabelCorrection('asset-0', {
      modelNumber: 'XE40',
      serialNumber: 'AB01234',
      manufactureMonth: '7',
      manufactureYear: '2013',
    })).toMatchObject({ manufactureMonth: 7, manufactureYear: 2013 })
  })
})

it('uses the same identified coil and date in the table and SMS, not the furnace age', async()=>{
 const {homeCheckResultsSms}=await import('../../supabase/functions/_shared/homeCheck/smsCopy')
 const coil=asset({system:'heating',manufactureDate:{year:2013,month:7}})
 coil.fields.make=field('International Comfort Products')
 coil.fields.model=field('END4X42L17A1')
 coil.fields.approximateAge=field(13)
 const label=homeCheckReviewLabels(coil)
 const result=homeCheckReviewResult(coil)
 const sms=homeCheckResultsSms({location:'Test Lane',assets:[coil],answers:{warningSigns:false,warningDetails:'',lastService:'',lastFilterChange:''},observerRole:'contractor',warning:null,pendingSystems:[],now:new Date('2026-11-02')})
 expect(label.categoryLabel).toBe('Heating system')
 expect(result.identifiedItem.type).toBe(label.categoryLabel)
 expect(label.manufactureLabel).toBe('Made July 2013')
 expect(sms).toContain(label.categoryLabel)
 expect(sms).toContain('Made July 2013; about 13 years old.')
 expect(sms).not.toMatch(/Photographed component|Furnace age/)
})

it('keeps a confirmed Home Check manufacture date in the appliance table result',()=>{
 const confirmed=asset({verified:true,system:'heating',manufactureDate:{year:2013,month:7}});
 expect(homeCheckReviewResult(confirmed).manufactureDate).toEqual({year:2013,month:7});
 expect(homeCheckReviewResult(asset({verified:true})).manufactureDate).toEqual({year:null,month:null});
});
