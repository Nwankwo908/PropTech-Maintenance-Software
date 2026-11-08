import { describe, expect, it } from 'vitest'
import { applyEquipmentManufactureAge, ageYearsFromManufactureDate } from './equipmentAge'
import type { ApplianceVisionResult } from './types'

const now = new Date('2026-10-22T12:00:00Z')

function reading(age: ApplianceVisionResult['estimatedAge'], manufactureDate?: { year: number | null; month: number | null }): ApplianceVisionResult & { manufactureDate?: { year: number | null; month: number | null } } {
  return {
    category: 'water_heater',
    identifiedItem: { type: 'Water heater', brand: 'Rheem', modelNumber: 'XE40M06', serialNumber: 'RH12345678' },
    estimatedAge: age,
    condition: { rating: 'fair', summary: 'Tank visible' },
    deficiencies: [],
    maintenanceRecommendations: [],
    ...(manufactureDate ? { manufactureDate } : {}),
  }
}

describe('Manufacture-date age', () => {
  it('turns March 2019 into 7 years as of October 22, 2026', () => {
    const result = applyEquipmentManufactureAge(reading({
      value: 4,
      confidence: 'high',
      basis: 'Manufacture date is clearly visible as 03/2019.',
    }), now)
    expect(result.estimatedAge.value).toBe(7)
    expect(result.estimatedAge.confidence).toBe('high')
    expect(result.estimatedAge.basis).toContain('March 2019')
    expect(result.estimatedAge.basis).toContain('October 22, 2026')
  })

  it('uses a structured month and year instead of the model arithmetic', () => {
    const result = applyEquipmentManufactureAge(reading(
      { value: 4, confidence: 'high', basis: 'Model guess' },
      { year: 2013, month: 7 },
    ), now)
    expect(result.estimatedAge.value).toBe(13)
  })

  it('counts a later anniversary month as not yet reached', () => {
    expect(ageYearsFromManufactureDate({ year: 2013, month: 12 }, now)?.value).toBe(12)
  })

  it('leaves age unknown during the manufacture month when the day is missing', () => {
    const age = ageYearsFromManufactureDate({ year: 2012, month: 10 }, now)
    expect(age?.value).toBeNull()
    expect(age?.basis).toContain('13 or 14')
  })

  it('leaves age unknown when only the year is confirmed', () => {
    const result = applyEquipmentManufactureAge(reading(
      { value: 10, confidence: 'high', basis: 'Date of manufacture 2013' },
    ), now)
    expect(result.estimatedAge.value).toBeNull()
    expect(result.estimatedAge.basis).toContain('month is unknown')
  })

  it('clears a guessed age when the label gives more than one date', () => {
    const result = applyEquipmentManufactureAge(reading({
      value: 8,
      confidence: 'high',
      basis: 'Could be Jul-2013 or Mar-2019.',
    }), now)
    expect(result.estimatedAge.value).toBeNull()
    expect(result.estimatedAge.basis).toContain('unclear')
  })

  it('keeps a serial-only estimate when no manufacture date was read', () => {
    const result = applyEquipmentManufactureAge(reading({
      value: 11,
      confidence: 'high',
      basis: 'Serial date code estimate',
    }), now)
    expect(result.estimatedAge.value).toBe(11)
  })
})

const serialReading = (serial = '5811D05533') => ({
 ...reading({value:null,confidence:'low',basis:'Manufacture year 2011'}, {year:2011,month:null}),
 category:'hvac' as const, identifiedItem:{type:'furnace',brand:'Lennox',modelNumber:'ML193UH090XP60B',serialNumber:serial},
 labelReadability:{status:'readable' as const,serialConfidence:100,modelConfidence:100,readings:{serialNumber:serial},formatWarnings:[],uncertainCharacters:[],retakeRequested:false},
})
it('decodes a verified Lennox serial without claiming its year was printed',()=>{
 const r=applyEquipmentManufactureAge(serialReading(),now)
 expect(r.manufactureDate).toEqual({year:2011,month:4})
 expect(r.estimatedAge.value).toBe(15)
 expect(r.estimatedAge.basis).toContain('Estimated from the Lennox serial number')
 expect(r.estimatedAge.basis).toContain('not a separately printed')
 expect(r.estimatedAge.basis).not.toContain('is visible')
})
it.each(['uncertain','unreadable'] as const)('does not decode a %s serial',status=>{
 const r=serialReading();r.labelReadability.status=status as never
 expect(applyEquipmentManufactureAge(r,now).estimatedAge.basis).not.toContain('Estimated from the Lennox')
})
it('does not decode serial candidates with uncertain characters or format warnings',()=>{
 for(const quality of [{serialConfidence:40},{formatWarnings:['Unverified format']},{uncertainCharacters:[{field:'serialNumber' as const,index:2,alternatives:['1','I']}]},{readings:{serialNumber:'5812D05533'}}]){
  const r=serialReading();Object.assign(r.labelReadability,quality)
  expect(applyEquipmentManufactureAge(r,now).estimatedAge.basis).not.toContain('Estimated from the Lennox')
 }
})
it('clears conflicting serial and recorded dates rather than choosing one',()=>{
 const r=serialReading();r.manufactureDate={year:2013,month:7}
 const next=applyEquipmentManufactureAge(r,now)
 expect(next.manufactureDate).toEqual({year:null,month:null});expect(next.estimatedAge.value).toBeNull()
 expect(next.estimatedAge.basis).toContain('conflicts')
})
it('does not invent a printed source for a year-only structured date',()=>{
 expect(applyEquipmentManufactureAge(reading({value:null,confidence:'low',basis:'Unknown'}, {year:2011,month:null}),now).estimatedAge.basis).not.toMatch(/visible|printed|label/)
})
it('preserves serial provenance when recalculating another manufacturer date',()=>{
 const r=applyEquipmentManufactureAge(reading({value:2,confidence:'high',basis:'Decoded from serial number as July 2013'}, {year:2013,month:7}),now)
 expect(r.estimatedAge.value).toBe(13);expect(r.estimatedAge.basis).toContain('Estimated from the serial number')
})
