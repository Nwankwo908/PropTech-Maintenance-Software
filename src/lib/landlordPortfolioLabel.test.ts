import { describe, expect, it } from 'vitest'
import {
  contactPropertiesLabel,
  landlordPortfolioLabel,
  storedLandlordCompanyName,
  usableOnboardingCompanyName,
} from '@shared/landlordPortfolioLabel'

describe('landlordPortfolioLabel', () => {
  it('uses the company name when one was entered', () => {
    expect(
      landlordPortfolioLabel({ companyName: 'Oak LLC', contactName: 'Alex Rivera' }),
    ).toBe('Oak LLC')
  })

  it('refers to [name] properties when company name is missing', () => {
    expect(landlordPortfolioLabel({ companyName: '', contactName: 'Alex Rivera' })).toBe(
      'Alex Rivera properties',
    )
    expect(landlordPortfolioLabel({ companyName: 'New Landlord', contactName: 'Alex' })).toBe(
      'Alex properties',
    )
  })

  it('does not treat the derived label as a saved company name', () => {
    expect(storedLandlordCompanyName('Alex Rivera properties', 'Alex Rivera')).toBe('')
    expect(storedLandlordCompanyName('Oak LLC', 'Alex Rivera')).toBe('Oak LLC')
    expect(usableOnboardingCompanyName('Limited Alpha 1')).toBe('')
    expect(usableOnboardingCompanyName('Kendo Homes')).toBe('')
    expect(usableOnboardingCompanyName('Kendo Properties LLC')).toBe('')
    expect(contactPropertiesLabel('Alex Rivera')).toBe('Alex Rivera properties')
  })
})
