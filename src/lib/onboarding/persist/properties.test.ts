import { describe, expect, it } from 'vitest'
import {
  collectExtractedUnitLabels,
  generateUnitLabels,
  listOnboardingUnitOptions,
  resolveOnboardingUnitLabels,
  uniqueOnboardingUnitLabels,
} from './properties'

describe('uniqueOnboardingUnitLabels', () => {
  it('keeps first spelling and drops blank / duplicate labels', () => {
    expect(uniqueOnboardingUnitLabels([' 1A ', '1a', '', '2B', '2B'])).toEqual(['1A', '2B'])
  })
})

describe('resolveOnboardingUnitLabels', () => {
  it('uses extracted labels instead of inventing 101…N from unitCount', () => {
    expect(
      resolveOnboardingUnitLabels({ unitCount: 4, unitLabels: ['1A', '2A', '3A'] }),
    ).toEqual(['1A', '2A', '3A'])
  })

  it('keeps saved inventory when the property only has a unit count', () => {
    expect(resolveOnboardingUnitLabels({ unitCount: 4 }, ['201', '202', '203', '204', '205'])).toEqual(
      ['201', '202', '203', '204', '205'],
    )
  })

  it('falls back to 101…N only when there is no real inventory', () => {
    expect(resolveOnboardingUnitLabels({ unitCount: 4 })).toEqual(generateUnitLabels(4))
    expect(generateUnitLabels(4)).toEqual(['101', '102', '103', '104'])
  })
})

describe('collectExtractedUnitLabels', () => {
  it('collects nine rent-roll units even when GPT unitCount is 4', () => {
    const labels = collectExtractedUnitLabels({
      propertyName: 'Maple Court',
      units: [{ label: '101', building: 'Maple Court', selected: true }],
      residents: Array.from({ length: 9 }, (_, index) => ({
        unit: String(101 + index),
        building: 'Maple Court',
        selected: true,
      })),
    })
    expect(labels).toHaveLength(9)
    expect(labels[0]).toBe('101')
    expect(labels[8]).toBe('109')
  })

  it('still collects resident units when building text drifted from the property name', () => {
    expect(
      collectExtractedUnitLabels({
        propertyName: 'Maple Court',
        residents: [
          { unit: '1A', building: 'Maple Court Rent Roll', selected: true },
          { unit: '2A', building: '', selected: true },
        ],
      }),
    ).toEqual(['1A', '2A'])
  })

  it('does not attach another property’s units when multiple buildings are selected', () => {
    expect(
      collectExtractedUnitLabels({
        propertyName: 'Maple Court',
        otherPropertyNames: ['Maple Court', 'Oak House'],
        residents: [
          { unit: '1A', building: 'Maple Court', selected: true },
          { unit: '2A', building: 'Oak House', selected: true },
        ],
      }),
    ).toEqual(['1A'])
  })
})

describe('listOnboardingUnitOptions', () => {
  it('offers extracted labels on the residents step instead of 101…N', () => {
    expect(
      listOnboardingUnitOptions([
        {
          id: 'prop-1',
          name: 'Maple Court',
          streetAddress: '100 Maple St',
          city: 'Atlanta',
          state: 'GA',
          zipCode: '30301',
          unitCount: 4,
          unitLabels: ['1A', '2A', '3A', '4A', '5A'],
        },
      ]).map((option) => option.unitLabel),
    ).toEqual(['1A', '2A', '3A', '4A', '5A'])
  })
})
