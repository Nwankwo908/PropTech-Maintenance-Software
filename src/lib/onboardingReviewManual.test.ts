import { describe, expect, it } from 'vitest'
import {
  emptyReviewManualAccount,
  mergeReviewManualAccount,
  usableOnboardingCompanyName,
} from './onboardingReviewManual'

describe('usableOnboardingCompanyName', () => {
  it('drops system placeholders so extraction can fill company name', () => {
    expect(usableOnboardingCompanyName('New Landlord')).toBe('')
    expect(usableOnboardingCompanyName('your portfolio')).toBe('')
    expect(usableOnboardingCompanyName('CEO Rentals NJ')).toBe('CEO Rentals NJ')
  })
})

describe('mergeReviewManualAccount', () => {
  it('keeps a typed company name and fills blanks from the seed', () => {
    expect(
      mergeReviewManualAccount(
        { companyName: '', contactName: 'Alex', email: '', phone: '' },
        { companyName: 'Acme Properties', email: 'alex@acme.test' },
      ),
    ).toMatchObject({
      companyName: 'Acme Properties',
      contactName: 'Alex',
      email: 'alex@acme.test',
    })
  })

  it('does not treat New Landlord as a real company name', () => {
    expect(
      emptyReviewManualAccount({ companyName: 'New Landlord', contactName: 'Alex' }).companyName,
    ).toBe('')
  })

  it('fills team member email from the seed when the review field is blank', () => {
    expect(
      mergeReviewManualAccount(
        { backupContactName: 'Sam', backupContactPhone: '', backupContactEmail: '' },
        { backupContactPhone: '555-0100', backupContactEmail: 'sam@acme.test' },
      ),
    ).toMatchObject({
      backupContactName: 'Sam',
      backupContactPhone: '555-0100',
      backupContactEmail: 'sam@acme.test',
    })
  })
})
