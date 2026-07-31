import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LandlordOnboardingState } from './types'
import {
  sampleResident,
  sampleVendor,
  TEST_LANDLORD_ID,
  validOnboardingState,
} from './testFixtures'

const {
  sendTenantActivationSms,
  sendVendorInvite,
  saveLandlordOnboarding,
  requireOnboardingLandlord,
  activateUnitsFromResidentAssignments,
  persistLandlordAccountProfile,
  persistLandlordCommunicationStyle,
  persistOnboardingProperties,
  supabaseFrom,
} = vi.hoisted(() => {
  const supabaseFrom = vi.fn()
  return {
    sendTenantActivationSms: vi.fn(),
    sendVendorInvite: vi.fn(),
    saveLandlordOnboarding: vi.fn(),
    requireOnboardingLandlord: vi.fn(),
    activateUnitsFromResidentAssignments: vi.fn(),
    persistLandlordAccountProfile: vi.fn(),
    persistLandlordCommunicationStyle: vi.fn(),
    persistOnboardingProperties: vi.fn(),
    supabaseFrom,
  }
})

vi.mock('@/api/tenantActivation', () => ({
  sendTenantActivationSms,
}))

vi.mock('@/api/vendorVerification', () => ({
  sendVendorInvite,
}))

vi.mock('@/lib/unitActivation', () => ({
  activateUnitsFromResidentAssignments,
}))

vi.mock('./draftStorage', () => ({
  requireOnboardingLandlord,
  saveLandlordOnboarding,
}))

vi.mock('./persist/account', () => ({
  persistLandlordAccountProfile,
  persistLandlordCommunicationStyle,
}))

vi.mock('./persist/properties', () => ({
  persistOnboardingProperties,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => supabaseFrom(...args),
  },
}))

import { completeOnboarding, isLandlordStripePayoutsReady } from './complete'

function mockPayoutsReady(ready: boolean) {
  supabaseFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: ready
            ? {
                stripe_connect_account_id: 'acct_test_landlord',
                stripe_connect_charges_enabled: true,
              }
            : {
                stripe_connect_account_id: null,
                stripe_connect_charges_enabled: false,
              },
          error: null,
        }),
      }),
    }),
  })
}

describe('isLandlordStripePayoutsReady', () => {
  beforeEach(() => {
    supabaseFrom.mockReset()
  })

  it('returns true only when Stripe charges are enabled', async () => {
    mockPayoutsReady(true)
    await expect(isLandlordStripePayoutsReady(TEST_LANDLORD_ID)).resolves.toBe(true)

    mockPayoutsReady(false)
    await expect(isLandlordStripePayoutsReady(TEST_LANDLORD_ID)).resolves.toBe(false)
  })

  it('fails closed on lookup errors', async () => {
    supabaseFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { message: 'boom' },
          }),
        }),
      }),
    })
    await expect(isLandlordStripePayoutsReady(TEST_LANDLORD_ID)).resolves.toBe(false)
  })
})

describe('completeOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireOnboardingLandlord.mockReturnValue({ ok: true, landlordId: TEST_LANDLORD_ID })
    saveLandlordOnboarding.mockResolvedValue(undefined)
    activateUnitsFromResidentAssignments.mockResolvedValue(undefined)
    persistLandlordAccountProfile.mockResolvedValue({ ok: true })
    persistLandlordCommunicationStyle.mockResolvedValue(undefined)
    persistOnboardingProperties.mockImplementation(async (properties) => ({
      ok: true,
      properties,
    }))
    mockPayoutsReady(true)
    sendTenantActivationSms.mockResolvedValue({
      configured: true,
      sent: 1,
      failed: 0,
    })
    sendVendorInvite.mockResolvedValue({
      delivery: { sms: 'sent', email: 'sent' },
    })
  })

  it('saves completed state and sends resident activation + vendor invites', async () => {
    const state = validOnboardingState()
    const residents = [
      sampleResident({ id: 'res-phone', phone: '+12025550111' }),
      sampleResident({ id: 'res-no-phone', phone: '', fullName: 'No Phone' }),
    ]
    const vendors = [
      sampleVendor({
        id: 'vendor-both',
        phone: '+12025550122',
        email: 'jobs@flex.test',
      }),
      sampleVendor({
        id: 'vendor-skip',
        name: 'No Contact LLC',
        phone: '',
        email: '',
      }),
    ]

    const result = await completeOnboarding(state, vendors, residents)

    expect(result).toEqual({ ok: true, activationWarning: undefined })
    expect(saveLandlordOnboarding).toHaveBeenCalledTimes(1)
    const saved = saveLandlordOnboarding.mock.calls[0]?.[0] as LandlordOnboardingState
    expect(saved.onboardingStatus).toBe('completed')
    expect(saved.currentStep).toBe('review')
    expect(saved.completedAt).toBeTruthy()
    expect(saved.landlordId).toBe(TEST_LANDLORD_ID)

    expect(sendTenantActivationSms).toHaveBeenCalledWith({
      landlordId: TEST_LANDLORD_ID,
      residentIds: ['res-phone'],
      companyName: 'Acme Properties',
    })

    expect(sendVendorInvite).toHaveBeenCalledTimes(1)
    expect(sendVendorInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        landlordId: TEST_LANDLORD_ID,
        vendorId: 'vendor-both',
        businessName: 'Flex Plumbing',
        channel: 'both',
        propertyName: 'Maple Court',
      }),
    )
  })

  it('still finishes setup when activation delivery fails', async () => {
    sendTenantActivationSms.mockResolvedValue({
      configured: true,
      sent: 0,
      failed: 1,
    })
    sendVendorInvite.mockResolvedValue({
      delivery: { sms: 'failed', email: 'failed' },
    })

    const result = await completeOnboarding(
      validOnboardingState(),
      [sampleVendor()],
      [sampleResident()],
    )

    expect(result.ok).toBe(true)
    expect(result.activationWarning).toMatch(/finished setup/i)
    expect(result.activationWarning).toMatch(/welcome texts/i)
    expect(result.activationWarning).toMatch(/verification invites/i)
    expect(saveLandlordOnboarding).toHaveBeenCalled()
  })

  it('does not send activation when required setup is missing', async () => {
    mockPayoutsReady(false)
    const result = await completeOnboarding(
      validOnboardingState({
        accountSetup: {
          companyName: '',
          contactName: '',
          email: '',
          phone: '',
          backupContactName: '',
          backupContactPhone: '',
        },
      }),
      [sampleVendor()],
      [sampleResident()],
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Missing/)
    expect(saveLandlordOnboarding).not.toHaveBeenCalled()
    expect(sendTenantActivationSms).not.toHaveBeenCalled()
    expect(sendVendorInvite).not.toHaveBeenCalled()
  })
})
