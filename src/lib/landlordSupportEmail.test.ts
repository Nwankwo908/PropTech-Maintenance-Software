import { describe, expect, it } from 'vitest'
import { resolveLandlordSupportEmail } from './landlordSupportEmail'

describe('resolveLandlordSupportEmail', () => {
  it('uses the onboarding address instead of the Alpha login mailbox', () => {
    expect(
      resolveLandlordSupportEmail({
        accountSetupEmail: 'nwankwo908@gmail.com',
        organizationSupportEmail: 'limitedalpha1@ulohome.io',
        landlordEmail: 'limitedalpha1@ulohome.io',
      }),
    ).toBe('nwankwo908@gmail.com')
  })

  it('does not fill Support email from the login mailbox alone', () => {
    expect(
      resolveLandlordSupportEmail({
        accountSetupEmail: '',
        organizationSupportEmail: '',
        landlordEmail: 'limitedalpha1@ulohome.io',
      }),
    ).toBe('')
  })
})
