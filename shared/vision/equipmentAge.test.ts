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
    expect(result.estimatedAge.basis).toContain('month is not')
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
