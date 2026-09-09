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

  it('matches Palm Springs FL when the report spells out Florida', () => {
    expect(
      inspectionReportAddressMatches({
        expectedStreet: '123 Main St',
        expectedCity: 'Palm Springs',
        expectedState: 'FL',
        expectedZip: '33461',
        expectedBuilding: 'Palm Springs',
        extracted: {
          street: '123 Main Street',
          city: 'Palm Springs',
          state: 'Florida',
          zip: '33461',
          raw: '123 Main Street, Palm Springs, Florida 33461',
        },
      }),
    ).toBe(true)
  })

  it('rejects Palm Springs CA against a Florida property', () => {
    expect(
      inspectionReportAddressMatches({
        expectedStreet: '123 Main St',
        expectedCity: 'Palm Springs',
        expectedState: 'FL',
        expectedZip: '33461',
        expectedBuilding: 'Palm Springs',
        extracted: {
          street: '123 Main Street',
          city: 'Palm Springs',
          state: 'CA',
          zip: '92262',
          raw: '123 Main Street, Palm Springs, CA 92262',
        },
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
