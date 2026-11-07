import { describe, expect, it } from 'vitest'
import { parseOptionalUsdAmount } from './parseOptionalUsdAmount'
import {
  computeVerificationChecklist,
  vendorComplianceActionNeededItems,
} from './vendorVerificationChecklist'

describe('parseOptionalUsdAmount', () => {
  it('reads dollars from formatted input', () => {
    expect(parseOptionalUsdAmount('$500,000')).toBe(500000)
    expect(parseOptionalUsdAmount('')).toBeNull()
  })
})

describe('computeVerificationChecklist', () => {
  it('verifies with trade only when license and insurance are omitted', () => {
    const checklist = computeVerificationChecklist({
      trade_categories: ['plumbing'],
    })
    expect(checklist.overall).toBe('verified')
    expect(checklist.items.find((i) => i.id === 'license')?.required).toBe(false)
    expect(checklist.items.find((i) => i.id === 'coi_coverage')?.required).toBe(false)
  })
})

describe('vendorComplianceActionNeededItems', () => {
  it('returns only action_needed rows', () => {
    const checklist = computeVerificationChecklist({
      trade_categories: ['plumbing'],
      license_number: 'LIC-1',
      license_expiration: '2020-01-01',
    })
    const items = vendorComplianceActionNeededItems(checklist)
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item) => item.status === 'action_needed')).toBe(true)
    expect(vendorComplianceActionNeededItems(null)).toEqual([])
  })
})
