import { describe, expect, it } from 'vitest'
import {
  applyVendorDistanceMiles,
  buildExternalSearchQueryLabel,
  enrichExternalVendorSuggestions,
  sanitizeExternalVendorDiscoveryForAccount,
} from './externalVendorDisplay'
import { filterVendorsWithVerifiedCoi } from './vendorCoiVerification'
import { filterVendorsWithVerifiedLicense } from './vendorLicenseVerification'

const electricalMocks = [
  {
    name: 'BrightWire Electric',
    rating: 4.7,
    reviewCount: 164,
    priceLabel: '$$ · Moderate',
    sources: ['mock' as const],
    etaMinutes: 40,
    phone: '(312) 555-0144',
    website: 'brightwireelectric.com',
  },
  {
    name: 'SafePanel Contractors',
    rating: 4.9,
    reviewCount: 88,
    priceLabel: '$$$ · Expensive',
    sources: ['mock' as const],
    etaMinutes: 55,
    phone: '(312) 555-0199',
    website: 'safepanelelectric.com',
  },
]

describe('enrichExternalVendorSuggestions', () => {
  it('keeps discovered vendors even when mock license/COI would drop them', () => {
    const licenseOnly = filterVendorsWithVerifiedLicense(electricalMocks, 'electrical')
    const both = filterVendorsWithVerifiedCoi(licenseOnly)
    expect(both.length).toBeLessThan(electricalMocks.length)

    const rows = enrichExternalVendorSuggestions(electricalMocks, 'electrical')
    expect(rows.map((row) => row.name)).toEqual(
      expect.arrayContaining(['BrightWire Electric', 'SafePanel Contractors']),
    )
    expect(rows.every((row) => row.distanceMiles == null)).toBe(true)
  })

  it('uses measured miles, not Thumbtack response-time ETA', () => {
    const rows = enrichExternalVendorSuggestions(
      [
        {
          name: 'J&J Telecom & Electric',
          rating: 4.8,
          reviewCount: 40,
          priceLabel: null,
          sources: ['thumbtack'],
          etaMinutes: 60,
          address: 'Toms River, NJ',
          distanceMiles: 59.5,
        },
      ],
      'electrical',
    )
    expect(rows[0]?.distanceMiles).toBe(59.5)
  })

  it('overlays driving miles and re-ranks by distance', () => {
    const rows = enrichExternalVendorSuggestions(
      [
        {
          name: 'Far Electric',
          rating: 5,
          reviewCount: 200,
          priceLabel: null,
          sources: ['thumbtack'],
          address: 'Toms River, NJ',
        },
        {
          name: 'Near Electric',
          rating: 4.2,
          reviewCount: 20,
          priceLabel: null,
          sources: ['thumbtack'],
          address: 'East Orange, NJ',
        },
      ],
      'electrical',
    )
    const overlay = applyVendorDistanceMiles(rows, {
      'Far Electric': 59.5,
      'Near Electric': 1.2,
    })
    expect(overlay.map((row) => row.name)).toEqual(['Near Electric', 'Far Electric'])
    expect(overlay[0]?.distanceMiles).toBe(1.2)
    expect(overlay[1]?.distanceMiles).toBe(59.5)
  })
})

describe('buildExternalSearchQueryLabel', () => {
  it('uses city, state, and ZIP — not a street address', () => {
    expect(buildExternalSearchQueryLabel('plumbing', 'Newark, NJ 07112')).toBe(
      'Plumbing repair · Newark, NJ 07112 · within 50 mi',
    )
  })
})

describe('sanitizeExternalVendorDiscoveryForAccount', () => {
  it('drops mock-only vendors on Alpha', () => {
    const live = {
      name: 'Real Electric Co',
      rating: 4.8,
      reviewCount: 40,
      priceLabel: null,
      sources: ['thumbtack' as const],
    }
    const sanitized = sanitizeExternalVendorDiscoveryForAccount({
      suggestions: [...electricalMocks, live],
      providersUsed: ['thumbtack', 'mock'],
      notice: 'No live matches nearby. Showing demo suggestions.',
    })
    expect(sanitized.suggestions.map((row) => row.name)).toEqual(['Real Electric Co'])
    expect(sanitized.providersUsed).toEqual(['thumbtack'])
    expect(sanitized.notice).toBeNull()
  })

  it('drops demo names such as Compliant Spark Electric', () => {
    const live = {
      name: 'Grove Street Electric',
      rating: 4.6,
      reviewCount: 80,
      priceLabel: null,
      sources: ['thumbtack' as const],
    }
    const fake = {
      name: 'Compliant Spark Electric',
      rating: 4.8,
      reviewCount: 142,
      priceLabel: 'Compliant · COI on file',
      sources: ['mock' as const],
    }
    const sanitized = sanitizeExternalVendorDiscoveryForAccount({
      suggestions: [fake, live],
      providersUsed: ['thumbtack', 'mock'],
    })
    expect(sanitized.suggestions.map((row) => row.name)).toEqual(['Grove Street Electric'])
  })
})
