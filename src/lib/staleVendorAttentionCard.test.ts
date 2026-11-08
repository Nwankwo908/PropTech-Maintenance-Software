import { describe, expect, it } from 'vitest'
import {
  staleVendorAttentionTitle,
  vendorDeclinedAttentionTitle,
} from '@/lib/maintenanceAdminVendor'
import {
  attentionTradeLabel,
  buildStaleVendorAttentionCard,
  formatVendorAttentionContextLabel,
  namedTrade,
  staleVendorAttentionSummary,
  vendorDeclinedAttentionSummary,
} from '@/lib/needsAttentionSummary'

describe('stale vendor attention card', () => {
  it('puts the vendor name in the title and summary when known', () => {
    expect(staleVendorAttentionTitle("Joe's Plumbing")).toBe(
      "Joe's Plumbing never accepted — needs reassignment",
    )
    expect(staleVendorAttentionSummary("Joe's Plumbing")).toBe(
      "Joe's Plumbing never accepted. Choose a new vendor.",
    )
  })

  it('falls back to the generic title and summary when the name is unknown', () => {
    expect(staleVendorAttentionTitle(null)).toBe(
      'Vendor unresponsive — needs reassignment',
    )
    expect(staleVendorAttentionTitle('')).toBe(
      'Vendor unresponsive — needs reassignment',
    )
    expect(staleVendorAttentionSummary(null)).toBe(
      'The assigned vendor never accepted. Choose a new vendor.',
    )
  })

  it('strips legal suffixes and never shortens to initials', () => {
    expect(staleVendorAttentionTitle('NTA Services LLC')).toBe(
      'NTA Services never accepted — needs reassignment',
    )
    expect(staleVendorAttentionSummary('NTA Services LLC')).toBe(
      'NTA Services never accepted. Choose a new vendor.',
    )
    expect(staleVendorAttentionTitle('NTA')).toBe(
      'Vendor unresponsive — needs reassignment',
    )
    expect(staleVendorAttentionTitle('Ecosafe Pest Management Inc.')).toMatch(
      /^Ecosafe Pest Management never accepted/,
    )
  })

  it('names the vendor on declined cards the same way', () => {
    expect(vendorDeclinedAttentionTitle("Joe's Plumbing LLC")).toBe(
      "Joe's Plumbing declined — find a replacement",
    )
    expect(vendorDeclinedAttentionSummary("Joe's Plumbing LLC")).toBe(
      "Joe's Plumbing declined. Find a replacement.",
    )
    expect(vendorDeclinedAttentionTitle(null)).toBe('Find a Replacement Vendor')
    expect(vendorDeclinedAttentionSummary(null)).toBe(
      'The assigned vendor declined. Find a replacement.',
    )
  })

  it('appends trade on the grey line and keeps property, unit, and tenant', () => {
    expect(
      formatVendorAttentionContextLabel({
        propertyLabel: '646 Bartlett',
        unitLabel: '1',
        residentName: 'Kenniesa Crews',
        propertyType: 'multifamily',
        trade: 'Plumbing',
      }),
    ).toBe('646 Bartlett · Unit 1 · Kenniesa Crews · Plumbing')
  })

  it('omits the trade when unknown and omits the unit for single-family', () => {
    expect(
      formatVendorAttentionContextLabel({
        propertyLabel: '646 Bartlett',
        unitLabel: '1',
        residentName: 'Kenniesa Crews',
        propertyType: 'multifamily',
        trade: null,
      }),
    ).toBe('646 Bartlett · Unit 1 · Kenniesa Crews')
    expect(
      formatVendorAttentionContextLabel({
        propertyLabel: '12 Oak St',
        unitLabel: '1',
        residentName: 'Jordan Lee',
        propertyType: 'single_family',
        trade: 'HVAC',
      }),
    ).toBe('12 Oak St · Jordan Lee · HVAC')
    expect(namedTrade('other')).toBeNull()
    expect(namedTrade('maintenance')).toBeNull()
    expect(namedTrade('general')).toBeNull()
    expect(attentionTradeLabel({ vendorCategory: 'plumbing', issueCategory: null })).toBe(
      'Plumbing',
    )
    expect(attentionTradeLabel({ vendorCategory: null, issueCategory: 'electrical' })).toBe(
      'Electrical',
    )
  })

  it('builds the same card for escalated-run and stale-ticket paths', () => {
    const input = {
      vendorName: "Joe's Plumbing LLC",
      propertyLabel: '646 Bartlett',
      unitLabel: '1',
      residentName: 'Kenniesa Crews',
      propertyType: 'multifamily',
      vendorCategory: 'plumbing',
      issueCategory: 'plumbing',
    }
    const fromEscalatedRun = buildStaleVendorAttentionCard(input)
    const fromStaleTicket = buildStaleVendorAttentionCard(input)
    expect(fromEscalatedRun).toEqual(fromStaleTicket)
    expect(fromEscalatedRun).toEqual({
      title: "Joe's Plumbing never accepted — needs reassignment",
      meta: "Joe's Plumbing never accepted. Choose a new vendor.",
      context: '646 Bartlett · Unit 1 · Kenniesa Crews · Plumbing',
    })
  })
})
