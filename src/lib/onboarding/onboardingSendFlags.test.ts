import { describe, expect, it } from 'vitest'
import {
  applyOnboardingSendFlags,
  residentOnboardingFlagMatchKeys,
} from './onboardingSendFlags'

describe('residentOnboardingFlagMatchKeys', () => {
  it('matches by phone digits even when formatting differs', () => {
    const extracted = residentOnboardingFlagMatchKeys({
      id: 'extract-1',
      fullName: 'Byron Ajiquiy Leja',
      unit: '1',
      phone: '(908) 884-3069',
    })
    const persisted = residentOnboardingFlagMatchKeys({
      id: '9117580e-12c7-4f1f-b4ca-29d4a3aed814',
      fullName: 'Byron Ajiquiy Leja',
      unit: '1',
      phone: '+19088843069',
    })
    expect(extracted.some((key) => persisted.includes(key))).toBe(true)
    expect(extracted).toContain('phone:9088843069')
    expect(persisted).toContain('phone:9088843069')
  })

  it('applies the Onboarding switch onto the DB roster after import', () => {
    const flagged = applyOnboardingSendFlags(
      [
        {
          id: '9117580e-12c7-4f1f-b4ca-29d4a3aed814',
          fullName: 'Byron Ajiquiy Leja',
          unit: '1',
          phone: '+19088843069',
          sendOnboardingOnComplete: false,
        },
      ],
      [
        {
          id: 'res-extract-9',
          fullName: 'Byron Ajiquiy Leja',
          unit: 'Unit 1',
          phone: '908-884-3069',
          sendOnboardingOnComplete: true,
        },
      ],
      residentOnboardingFlagMatchKeys,
    )
    expect(flagged[0]?.sendOnboardingOnComplete).toBe(true)
  })
})
