import { describe, expect, it } from 'vitest'
import {
  buildVendorComplianceProfile,
  mapQueriesForVendorServiceArea,
  vendorServiceAreaCoversProperty,
} from './vendorComplianceProfile'

describe('mapQueriesForVendorServiceArea', () => {
  it('uses verification form cities and ZIPs, not HQ, when coverage is set', () => {
    const profile = buildVendorComplianceProfile(
      { name: 'Flex Plumbing' },
      {
        service_area: {
          cities: ['Chicago', 'Evanston'],
          zips: ['60614', '60201'],
          radiusMiles: 25,
        },
      },
    )
    expect(
      mapQueriesForVendorServiceArea(profile.serviceArea, 'Dallas, TX'),
    ).toEqual(['Chicago, 60614', 'Evanston', '60201'])
  })

  it('pins the vendor map on city, state, ZIP, and radius from the verification form', () => {
    const profile = buildVendorComplianceProfile(
      { name: 'Flex Plumbing' },
      {
        service_area: {
          cities: ['Chicago'],
          counties: ['IL'],
          zips: ['60614'],
          radiusMiles: 40,
          centerAddress: 'Chicago, IL, 60614',
        },
      },
    )
    expect(profile.serviceArea.radiusMiles).toBe(40)
    expect(profile.serviceArea.stateCode).toBe('IL')
    expect(
      mapQueriesForVendorServiceArea(profile.serviceArea, 'Dallas, TX'),
    ).toEqual(['Chicago, IL, 60614'])
  })

  it('falls back to HQ location when the form has no coverage', () => {
    const profile = buildVendorComplianceProfile({ name: 'Flex Plumbing' })
    expect(mapQueriesForVendorServiceArea(profile.serviceArea, 'Atlanta, GA')).toEqual([
      'Atlanta, GA',
    ])
  })

  it('uses centerAddress from the form when present', () => {
    const profile = buildVendorComplianceProfile(
      { name: 'Flex Plumbing' },
      { service_area: { centerAddress: '60614', zips: ['60614'] } },
    )
    expect(mapQueriesForVendorServiceArea(profile.serviceArea, 'Dallas')).toEqual(['60614'])
  })
})

describe('vendorServiceAreaCoversProperty', () => {
  const chicagoProperty = {
    city: 'Chicago',
    state: 'IL',
    zipCode: '60614',
    streetAddress: '901 Maple Heights Blvd',
    addressLine: '901 Maple Heights Blvd Chicago, IL 60614',
  }

  it('matches a listed ZIP', () => {
    const profile = buildVendorComplianceProfile(
      { name: 'Flex Plumbing' },
      { service_area: { zips: ['60614'], cities: ['Evanston'] } },
    )
    expect(vendorServiceAreaCoversProperty(profile.serviceArea, chicagoProperty)).toBe(true)
  })

  it('matches a listed city', () => {
    const profile = buildVendorComplianceProfile(
      { name: 'Flex Plumbing' },
      { service_area: { cities: ['Chicago'], zips: [] } },
    )
    expect(vendorServiceAreaCoversProperty(profile.serviceArea, chicagoProperty)).toBe(true)
  })

  it('excludes a different metro', () => {
    const profile = buildVendorComplianceProfile(
      { name: 'Flex Plumbing' },
      { service_area: { cities: ['Dallas'], zips: ['75201'] } },
    )
    expect(vendorServiceAreaCoversProperty(profile.serviceArea, chicagoProperty)).toBe(false)
  })

  it('uses HQ when no coverage is on file', () => {
    const profile = buildVendorComplianceProfile({ name: 'Flex Plumbing' })
    expect(
      vendorServiceAreaCoversProperty(profile.serviceArea, chicagoProperty, 'Chicago, IL'),
    ).toBe(true)
    expect(
      vendorServiceAreaCoversProperty(profile.serviceArea, chicagoProperty, 'Dallas, TX'),
    ).toBe(false)
  })
})
