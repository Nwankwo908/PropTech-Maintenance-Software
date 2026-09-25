import { describe, expect, it } from 'vitest'
import {
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
  FULL_ALPHA_LANDLORD_ID,
  EMPTY_LANDLORD_ID,
} from '@shared/landlordCapabilities'
import { DEMO_LANDLORD_ID } from '@/lib/activeLandlord'
import { defaultOnboardingApprovalRules } from '@/lib/onboardingApprovalRules'
import {
  assertFactoryResetAccountShape,
  expectedFactoryResetAccountShape,
  factoryResetLandlordSeed,
  factoryResetOnboardingClearRow,
} from './factoryResetAccountShape'

describe('factoryResetAccountShape', () => {
  it('defines seeded blank shapes for Limited Alpha 1 and 2 only', () => {
    expect(factoryResetLandlordSeed(LIMITED_ALPHA_1_LANDLORD_ID)).toEqual({
      name: 'Limited Alpha 1',
      email: 'limitedalpha1@ulohome.io',
    })
    expect(factoryResetLandlordSeed(LIMITED_ALPHA_2_LANDLORD_ID)).toEqual({
      name: 'Limited Alpha 2',
      email: 'limitedalpha2@ulohome.io',
    })
    expect(factoryResetLandlordSeed(DEMO_LANDLORD_ID)).toBeNull()
    expect(factoryResetLandlordSeed(EMPTY_LANDLORD_ID)).toBeNull()
    expect(factoryResetLandlordSeed(FULL_ALPHA_LANDLORD_ID)).toBeNull()
  })

  it('passes when every Account Setup–writable field matches the blank shape', () => {
    for (const landlordId of [LIMITED_ALPHA_1_LANDLORD_ID, LIMITED_ALPHA_2_LANDLORD_ID]) {
      const expected = expectedFactoryResetAccountShape(landlordId)
      expect(expected).not.toBeNull()
      if (!expected) continue
      const rules = defaultOnboardingApprovalRules()
      const result = assertFactoryResetAccountShape(expected, {
        landlord: {
          name: expected.landlord.name,
          email: expected.landlord.email,
          contact_name: null,
          phone: null,
        },
        onboarding: {
          onboarding_status: 'not_started',
          current_step: 'entry',
          account_settings: {},
          emergency_contact: {},
          draft_state: {
            setupPath: null,
            accountSetup: expected.onboarding.draft_account_setup,
          },
          auto_approval_threshold: rules.autoApprovalThreshold,
          notification_preference: rules.notificationPreference,
          notification_channel: rules.notificationChannel,
          communication_style: rules.communicationStyle,
        },
      })
      expect(result).toEqual({ ok: true })
    }
  })

  it('fails when account_settings, landlords.email, or draft leftovers remain', () => {
    const expected = expectedFactoryResetAccountShape(LIMITED_ALPHA_2_LANDLORD_ID)!
    const rules = defaultOnboardingApprovalRules()
    const result = assertFactoryResetAccountShape(expected, {
      landlord: {
        name: 'Limited Alpha 2',
        email: 'otbpictures12@gmail.com',
        contact_name: 'Prior Tester',
        phone: '+12025550111',
      },
      onboarding: {
        onboarding_status: 'not_started',
        current_step: 'entry',
        account_settings: {
          organization: {
            supportEmail: 'otbpictures12@gmail.com',
            backupContactEmail: 'team@example.com',
          },
        },
        emergency_contact: { name: 'Backup', phone: '+1', email: 'a@b.c', role: 'backup' },
        draft_state: {
          accountSetup: {
            companyName: '',
            contactName: '',
            email: 'otbpictures12@gmail.com',
            phone: '',
            backupContactName: 'Team',
            backupContactPhone: '',
            backupContactEmail: 'team@example.com',
            smsConsentAcceptedAt: '2026-01-01T00:00:00.000Z',
          },
        },
        auto_approval_threshold: rules.autoApprovalThreshold,
        notification_preference: 'all',
        notification_channel: 'sms',
        communication_style: rules.communicationStyle,
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.mismatches.some((m) => m.startsWith('landlords.email'))).toBe(true)
    expect(result.mismatches.some((m) => m.startsWith('landlords.contact_name'))).toBe(true)
    expect(result.mismatches.some((m) => m.startsWith('landlords.phone'))).toBe(true)
    expect(result.mismatches.some((m) => m.startsWith('landlord_onboarding.account_settings'))).toBe(
      true,
    )
    expect(result.mismatches.some((m) => m.startsWith('landlord_onboarding.emergency_contact'))).toBe(
      true,
    )
    expect(
      result.mismatches.some((m) =>
        m.startsWith('landlord_onboarding.draft_state.accountSetup.email'),
      ),
    ).toBe(true)
    expect(
      result.mismatches.some((m) =>
        m.startsWith('landlord_onboarding.notification_preference'),
      ),
    ).toBe(true)
  })

  it('builds a clear row that includes account_settings, emergency_contact, and draft accountSetup', () => {
    const expected = expectedFactoryResetAccountShape(LIMITED_ALPHA_1_LANDLORD_ID)!
    const row = factoryResetOnboardingClearRow(expected)
    expect(row.account_settings).toEqual({})
    expect(row.emergency_contact).toEqual({})
    expect(row.onboarding_status).toBe('not_started')
    expect(row.current_step).toBe('entry')
    expect(row.onboarding_session_id).toBeNull()
    expect(row.onboarding_session_started_at).toBeNull()
    expect(row.draft_state).toEqual({
      setupPath: null,
      accountSetup: expected.onboarding.draft_account_setup,
      approvalRules: expected.onboarding.approval_rules,
    })
  })
})
