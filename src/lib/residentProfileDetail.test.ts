import { describe, expect, it } from 'vitest'
import { displayResidentEmail, residentEmailPatchForSave } from './residentProfileDetail'

describe('residentEmailPatchForSave', () => {
  it('omits email when the form still shows the stored address', () => {
    expect(residentEmailPatchForSave('ada@example.com', 'ada@example.com')).toBeUndefined()
    expect(residentEmailPatchForSave('  ada@example.com  ', 'ada@example.com')).toBeUndefined()
  })

  it('omits email when the field is blank and the row has no real email', () => {
    expect(residentEmailPatchForSave('', '')).toBeUndefined()
    expect(residentEmailPatchForSave('', 'res-1@onboarding.local')).toBeUndefined()
    expect(residentEmailPatchForSave('', null)).toBeUndefined()
  })

  it('sends a newly entered or cleared address', () => {
    expect(residentEmailPatchForSave('new@example.com', 'old@example.com')).toBe('new@example.com')
    expect(residentEmailPatchForSave('', 'old@example.com')).toBe('')
    expect(residentEmailPatchForSave('ada@example.com', '')).toBe('ada@example.com')
  })
})

describe('displayResidentEmail', () => {
  it('hides onboarding placeholder addresses', () => {
    expect(displayResidentEmail('res-1@onboarding.local')).toBeNull()
    expect(displayResidentEmail('ada@example.com')).toBe('ada@example.com')
  })
})
