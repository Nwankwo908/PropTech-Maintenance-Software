import { describe, expect, it } from 'vitest'
import {
  formatExpectedInspectionAddress,
  inspectionReportAddressMatches,
} from '@/lib/inspectionAddressMatch'

describe('inspectionReportAddressMatches', () => {
  const expected = {
    expectedStreet: '12 Maple Street',
    expectedCity: 'Newark',
    expectedState: 'NJ',
    expectedZip: '07104',
    expectedBuilding: '12 Maple St',
  }

  it('accepts the same street, city, and zip with abbreviations', () => {
    expect(
      inspectionReportAddressMatches({
        ...expected,
        extracted: {
          street: '12 Maple St',
          city: 'Newark',
          state: 'NJ',
          zip: '07104',
          raw: '12 Maple St, Newark, NJ 07104',
        },
      }),
    ).toBe(true)
  })

  it('rejects a different street number', () => {
    expect(
      inspectionReportAddressMatches({
        ...expected,
        extracted: {
          street: '90 Maple Street',
          city: 'Newark',
          state: 'NJ',
          zip: '07104',
          raw: '90 Maple Street, Newark, NJ 07104',
        },
      }),
    ).toBe(false)
  })

  it('rejects a different ZIP code', () => {
    expect(
      inspectionReportAddressMatches({
        ...expected,
        extracted: {
          street: '12 Maple Street',
          city: 'Newark',
          state: 'NJ',
          zip: '07105',
          raw: '12 Maple Street, Newark, NJ 07105',
        },
      }),
    ).toBe(false)
  })

  it('rejects a report with no readable address', () => {
    expect(
      inspectionReportAddressMatches({
        ...expected,
        extracted: { street: '', city: '', state: '', zip: '', raw: '' },
      }),
    ).toBe(false)
  })

  it('formats the expected property line for error copy', () => {
    expect(
      formatExpectedInspectionAddress({
        street: '12 Maple Street',
        city: 'Newark',
        state: 'NJ',
        zip: '07104',
        building: '12 Maple St',
      }),
    ).toContain('Newark')
  })
})
