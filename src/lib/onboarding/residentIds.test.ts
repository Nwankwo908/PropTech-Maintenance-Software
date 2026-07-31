import { describe, expect, it } from 'vitest'
import {
  maxOnboardingResidentSequence,
  nextOnboardingResidentIdFromSequence,
  onboardingResidentIdPrefix,
} from './residentIds'
import type { OnboardingResident } from './persist/residents'

const LANDLORD = 'abcdef12-3456-7890-abcd-ef1234567890'

function resident(residentId: string): OnboardingResident {
  return {
    id: residentId,
    residentId,
    fullName: 'Test',
    unit: '101',
    building: 'A',
    email: '',
    phone: '',
    monthlyRent: null,
    rentDueDay: null,
    leaseStart: null,
    leaseEnd: null,
    maintenanceResponsibilitiesClause: null,
    occupancyStatus: 'active',
  }
}

describe('onboardingResidentIdPrefix', () => {
  it('scopes by the first 8 hex chars of the landlord id', () => {
    expect(onboardingResidentIdPrefix(LANDLORD)).toBe('ONBABCDEF12')
  })
})

describe('maxOnboardingResidentSequence', () => {
  it('reads landlord-scoped ONB{prefix}-NNN ids', () => {
    const prefix = onboardingResidentIdPrefix(LANDLORD)
    const residents = [
      resident(`${prefix}-001`),
      resident(`${prefix}-007`),
      resident(`${prefix}-003`),
    ]
    expect(maxOnboardingResidentSequence(residents, LANDLORD)).toBe(7)
  })

  it('still parses legacy ONB- / RES- sequences', () => {
    expect(
      maxOnboardingResidentSequence(
        [resident('ONB-012'), resident('RES-004'), resident('junk')],
        LANDLORD,
      ),
    ).toBe(12)
  })

  it('ignores ids for other landlords when scoped', () => {
    const prefix = onboardingResidentIdPrefix(LANDLORD)
    expect(
      maxOnboardingResidentSequence(
        [resident('ONBOTHER00-099'), resident(`${prefix}-002`)],
        LANDLORD,
      ),
    ).toBe(2)
  })
})

describe('nextOnboardingResidentIdFromSequence', () => {
  it('pads to three digits under the landlord prefix', () => {
    expect(nextOnboardingResidentIdFromSequence(5, LANDLORD)).toBe('ONBABCDEF12-005')
    expect(nextOnboardingResidentIdFromSequence(1, LANDLORD)).toBe('ONBABCDEF12-001')
  })
})
