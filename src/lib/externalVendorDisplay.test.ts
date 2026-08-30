import { describe, expect, it } from 'vitest'
import {
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
