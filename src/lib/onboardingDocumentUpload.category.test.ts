import { describe, expect, it } from 'vitest'
import { inferDocumentCategory } from './onboardingDocumentUpload'

describe('inferDocumentCategory', () => {
  it('classifies lease agreements from common filenames', () => {
    expect(inferDocumentCategory('Unit 4B Lease Agreement.pdf')).toBe('lease_agreement')
    expect(inferDocumentCategory('Residential Tenancy Agreement.pdf')).toBe(
      'lease_agreement',
    )
    expect(inferDocumentCategory('Occupancy Agreement - 101.pdf')).toBe(
      'lease_agreement',
    )
    expect(inferDocumentCategory('rental-agreement-smith.docx')).toBe(
      'lease_agreement',
    )
  })

  it('still classifies rent rolls separately', () => {
    expect(inferDocumentCategory('April rent roll.xlsx')).toBe('rent_roll')
    expect(inferDocumentCategory('tenant roster.csv')).toBe('rent_roll')
  })
})
