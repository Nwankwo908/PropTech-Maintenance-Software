import { describe, expect, it } from 'vitest'
import { parseOptionalUsdAmount } from './parseOptionalUsdAmount'
import {
  computeVerificationChecklist,
  computeVendorProfileVerificationChecklist,
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
  it('returns only Action needed compliance rows', () => {
    const checklist = computeVendorProfileVerificationChecklist({
      trade_categories: ['plumbing'],
      license_number: 'PL-1',
      license_expiration: '2020-01-01',
      coi_general_liability: 500_000,
      coi_expiration: '2020-01-01',
      w9_received: true,
    })
    const items = vendorComplianceActionNeededItems(checklist)
    expect(items.map((item) => item.id).sort()).toEqual(['coi_coverage', 'license', 'w9'])
    expect(items.every((item) => item.status === 'action_needed')).toBe(true)
  })

  it('is empty when nothing needs action', () => {
    expect(
      vendorComplianceActionNeededItems(
        computeVendorProfileVerificationChecklist({ trade_categories: ['plumbing'] }),
      ),
    ).toEqual([])
    expect(vendorComplianceActionNeededItems(null)).toEqual([])
  })
})
