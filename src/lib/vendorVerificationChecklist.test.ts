import { describe, expect, it } from 'vitest'
import { parseOptionalUsdAmount } from './parseOptionalUsdAmount'
import { computeVerificationChecklist } from './vendorVerificationChecklist'

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
