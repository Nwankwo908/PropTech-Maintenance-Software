import { describe, expect, it } from 'vitest'
import { staffSwitcherSignupLabel, staffSwitcherSignupOptions } from './staffSwitcherAccounts'

describe('staffSwitcherSignupOptions', () => {
  it('lists every new account with its number and email', () => {
    const options = staffSwitcherSignupOptions([
      { landlordId: 'a13a0000-2222-4222-8222-222222222222', alphaNumber: 4, email: 'later@example.com' },
      { landlordId: 'a13a0000-1111-4111-8111-111111111111', alphaNumber: 3, email: 'first@example.com' },
    ])
    expect(options.map((option) => option.label)).toEqual([
      'Limited Alpha 3 · first@example.com',
      'Limited Alpha 4 · later@example.com',
    ])
  })

  it('still names an account when no email is stored', () => {
    expect(staffSwitcherSignupLabel({ alphaNumber: 5, email: '  ' })).toBe('Limited Alpha 5')
  })
})
