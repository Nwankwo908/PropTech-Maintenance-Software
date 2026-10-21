import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LandlordOnboardingState } from './types'
import {
  sampleResident,
  sampleVendor,
  TEST_LANDLORD_ID,
  validOnboardingState,
} from './testFixtures'

const {
  recordActivityLog,
  saveLandlordOnboardingConfirmed,
  requireOnboardingLandlord,
  activateUnitsFromResidentAssignments,
  persistLandlordAccountProfile,
  persistLandlordDefaultRentDueDay,
  persistLandlordCommunicationStyle,
  persistOnboardingProperties,
  sendLandlordOnboardingWelcome,
  sendTenantWelcomeSms,
  sendVendorInvite,
  importOnboardingResidentsFromExtraction,
  fetchOnboardingResidents,
  fetchOnboardingVendors,
  supabaseFrom,
} = vi.hoisted(() => {
  const supabaseFrom = vi.fn()
  return {
    recordActivityLog: vi.fn(),
    saveLandlordOnboardingConfirmed: vi.fn(),
    requireOnboardingLandlord: vi.fn(),
    activateUnitsFromResidentAssignments: vi.fn(),
    persistLandlordAccountProfile: vi.fn(),
    persistLandlordDefaultRentDueDay: vi.fn(),
    persistLandlordCommunicationStyle: vi.fn(),
    persistOnboardingProperties: vi.fn(),
    sendLandlordOnboardingWelcome: vi.fn(),
    sendTenantWelcomeSms: vi.fn(),
    sendVendorInvite: vi.fn(),
    importOnboardingResidentsFromExtraction: vi.fn(),
    fetchOnboardingResidents: vi.fn(),
    fetchOnboardingVendors: vi.fn(),
    supabaseFrom,
  }
})

vi.mock('@/api/landlordOnboardingWelcome', () => ({
  sendLandlordOnboardingWelcome,
}))

vi.mock('@/api/tenantActivation', () => ({
  sendTenantWelcomeSms,
}))

vi.mock('@/api/vendorVerification', () => ({
  sendVendorInvite,
}))

vi.mock('@/lib/unitActivation', () => ({
  activateUnitsFromResidentAssignments,
}))

vi.mock('./draftStorage', () => ({
  requireOnboardingLandlord,
  saveLandlordOnboardingConfirmed,
}))

vi.mock('./persist/account', () => ({
  persistLandlordAccountProfile,
  persistLandlordDefaultRentDueDay,
  persistLandlordCommunicationStyle,
}))

vi.mock('./persist/properties', () => ({
  persistOnboardingProperties,
}))

vi.mock('./persist/residents', async () => {
  const actual = await vi.importActual<typeof import('./persist/residents')>(
    './persist/residents',
  )
  return {
    ...actual,
    fetchOnboardingResidents,
  }
})

vi.mock('./persist/vendors', async () => {
  const actual = await vi.importActual<typeof import('./persist/vendors')>(
    './persist/vendors',
  )
  return {
    ...actual,
    fetchOnboardingVendors,
  }
})

vi.mock('./persist/importResidents', async () => {
  const actual = await vi.importActual<typeof import('./persist/importResidents')>(
    './persist/importResidents',
  )
  return {
    ...actual,
    importOnboardingResidentsFromExtraction,
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => supabaseFrom(...args),
  },
}))

vi.mock('@/lib/recordActivityLog', () => ({
  recordActivityLog,
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
    saveLandlordOnboardingConfirmed.mockResolvedValue({ ok: true })
    activateUnitsFromResidentAssignments.mockResolvedValue(undefined)
    persistLandlordAccountProfile.mockResolvedValue({ ok: true })
    persistLandlordDefaultRentDueDay.mockResolvedValue({ ok: true })
    persistLandlordCommunicationStyle.mockResolvedValue({ ok: true })
    persistOnboardingProperties.mockImplementation(async (properties) => ({
      ok: true,
      properties,
    }))
    importOnboardingResidentsFromExtraction.mockImplementation(async (rows: unknown[]) =>
      Array.isArray(rows) ? rows.length : 0,
    )
    fetchOnboardingResidents.mockResolvedValue([])
    fetchOnboardingVendors.mockResolvedValue([])
    sendTenantWelcomeSms.mockResolvedValue({ ok: true, configured: true })
    sendVendorInvite.mockResolvedValue({
      ok: true,
      verificationId: 'ver-1',
      token: 'tok',
      link: 'https://example.com/v/tok',
      delivery: { sms: 'sent', email: null },
    })
    recordActivityLog.mockResolvedValue(undefined)
    sendLandlordOnboardingWelcome.mockResolvedValue({
      ok: true,
      configured: true,
      smsSent: ['+12025550100'],
      emailSent: ['owner@example.com'],
    })
    mockPayoutsReady(true)
  })

  it('saves completed state and sends landlord welcome message', async () => {
    const state = validOnboardingState()
    const residents = [
      sampleResident({ id: 'res-phone', phone: '+12025550111' }),
      sampleResident({ id: 'res-no-phone', phone: '', fullName: 'No Phone' }),
    ]
    fetchOnboardingResidents.mockResolvedValue(residents)
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

    expect(result.ok).toBe(true)
    expect(result.activationWarning).toBe(
      'Setup complete. Send remaining resident welcome texts and vendor verification invites from Residents and Vendors when you are ready.',
    )
    expect(sendTenantWelcomeSms).not.toHaveBeenCalled()
    expect(saveLandlordOnboardingConfirmed).toHaveBeenCalledTimes(1)
    const saved = saveLandlordOnboardingConfirmed.mock.calls[0]?.[0] as LandlordOnboardingState
    expect(saved.onboardingStatus).toBe('completed')
    expect(saved.currentStep).toBe('review')
    expect(saved.completedAt).toBeTruthy()
    expect(saved.landlordId).toBe(TEST_LANDLORD_ID)

    expect(persistOnboardingProperties).toHaveBeenCalled()
    expect(persistLandlordAccountProfile).toHaveBeenCalledWith(
      TEST_LANDLORD_ID,
      state.accountSetup,
    )
    expect(persistLandlordDefaultRentDueDay).toHaveBeenCalledWith(TEST_LANDLORD_ID, 1)
    expect(importOnboardingResidentsFromExtraction).toHaveBeenCalled()
    expect(activateUnitsFromResidentAssignments).toHaveBeenCalledWith(
      expect.objectContaining({
        landlordId: TEST_LANDLORD_ID,
        source: 'onboarding_complete',
      }),
    )
    const persistOrder = persistOnboardingProperties.mock.invocationCallOrder[0] ?? 0
    const residentOrder = importOnboardingResidentsFromExtraction.mock.invocationCallOrder[0] ?? 0
    const activateOrder = activateUnitsFromResidentAssignments.mock.invocationCallOrder[0] ?? 0
    const profileOrder = persistLandlordAccountProfile.mock.invocationCallOrder[0] ?? 0
    const completedOrder = saveLandlordOnboardingConfirmed.mock.invocationCallOrder[0] ?? 0
    expect(persistOrder).toBeLessThan(residentOrder)
    expect(residentOrder).toBeLessThan(activateOrder)
    expect(profileOrder).toBeLessThan(completedOrder)

    expect(sendLandlordOnboardingWelcome).toHaveBeenCalledWith(
      expect.objectContaining({
        landlordId: TEST_LANDLORD_ID,
        companyName: expect.any(String),
        contactName: expect.any(String),
        email: 'alex@acme.test',
      }),
    )

    expect(recordActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        landlordId: TEST_LANDLORD_ID,
        eventType: 'onboarding.completed',
        metadata: expect.objectContaining({
          tenants_pending_outreach: 1,
          vendors_pending_outreach: 1,
          message: expect.stringMatching(/welcome message was sent/i),
        }),
      }),
    )
  })

  it('still finishes setup when activity log fails', async () => {
    recordActivityLog.mockRejectedValue(new Error('log failed'))
    const residents = [sampleResident()]
    fetchOnboardingResidents.mockResolvedValue(residents)

    const result = await completeOnboarding(
      validOnboardingState(),
      [sampleVendor()],
      residents,
    )

    expect(result.ok).toBe(true)
    expect(result.activationWarning).toBe(
      'Setup complete. Send remaining resident welcome texts and vendor verification invites from Residents and Vendors when you are ready.',
    )
    expect(saveLandlordOnboardingConfirmed).toHaveBeenCalled()
  })

  it('fails closed when property persist fails', async () => {
    persistOnboardingProperties.mockResolvedValueOnce({
      ok: false,
      error: 'Could not save properties.',
    })

    const result = await completeOnboarding(
      validOnboardingState(),
      [sampleVendor()],
      [sampleResident()],
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Could not save properties/)
    expect(saveLandlordOnboardingConfirmed).not.toHaveBeenCalled()
    expect(persistLandlordAccountProfile).not.toHaveBeenCalled()
    expect(sendLandlordOnboardingWelcome).not.toHaveBeenCalled()
    expect(sendTenantWelcomeSms).not.toHaveBeenCalled()
  })

  it('fails closed when resident persist is partial', async () => {
    importOnboardingResidentsFromExtraction.mockResolvedValueOnce(0)

    const result = await completeOnboarding(
      validOnboardingState(),
      [sampleVendor()],
      [sampleResident()],
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Could not save all residents/)
    expect(saveLandlordOnboardingConfirmed).not.toHaveBeenCalled()
    expect(persistLandlordAccountProfile).not.toHaveBeenCalled()
    expect(sendLandlordOnboardingWelcome).not.toHaveBeenCalled()
  })

  it('fails closed when communication style persist fails before completion', async () => {
    const residents = [sampleResident()]
    fetchOnboardingResidents.mockResolvedValue(residents)
    persistLandlordCommunicationStyle.mockResolvedValueOnce({
      ok: false,
      error: 'Could not save communication style.',
    })

    const result = await completeOnboarding(
      validOnboardingState(),
      [sampleVendor()],
      residents,
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/communication/i)
    expect(saveLandlordOnboardingConfirmed).not.toHaveBeenCalled()
    expect(sendLandlordOnboardingWelcome).not.toHaveBeenCalled()
  })

  it('fails closed when account profile persist fails before completion', async () => {
    const residents = [sampleResident()]
    fetchOnboardingResidents.mockResolvedValue(residents)
    persistLandlordAccountProfile.mockResolvedValueOnce({
      ok: false,
      error: 'Could not save account profile.',
    })

    const result = await completeOnboarding(
      validOnboardingState(),
      [sampleVendor()],
      residents,
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/account profile/i)
    expect(saveLandlordOnboardingConfirmed).not.toHaveBeenCalled()
    expect(sendLandlordOnboardingWelcome).not.toHaveBeenCalled()
    expect(sendTenantWelcomeSms).not.toHaveBeenCalled()
    expect(recordActivityLog).not.toHaveBeenCalled()
  })

  it('fails closed when final completion status save fails', async () => {
    const residents = [sampleResident()]
    fetchOnboardingResidents.mockResolvedValue(residents)
    saveLandlordOnboardingConfirmed.mockResolvedValueOnce({
      ok: false,
      error: 'Could not confirm setup completion.',
    })

    const result = await completeOnboarding(
      validOnboardingState(),
      [sampleVendor()],
      residents,
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/confirm setup completion/i)
    expect(persistLandlordAccountProfile).toHaveBeenCalled()
    expect(sendLandlordOnboardingWelcome).not.toHaveBeenCalled()
    expect(recordActivityLog).not.toHaveBeenCalled()
  })

  it('fails closed when reviewed residents are missing from canonical inventory', async () => {
    fetchOnboardingResidents.mockResolvedValue([])

    const result = await completeOnboarding(
      validOnboardingState(),
      [sampleVendor()],
      [sampleResident({ id: 'res-missing', fullName: 'Ghost Tenant' })],
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Could not verify/)
    expect(saveLandlordOnboardingConfirmed).not.toHaveBeenCalled()
    expect(sendLandlordOnboardingWelcome).not.toHaveBeenCalled()
  })

  it('sends welcome SMS for residents with Onboarding switch enabled', async () => {
    const optedIn = sampleResident({
      id: 'res-opt-in',
      phone: '+12025550111',
      sendOnboardingOnComplete: true,
    })
    fetchOnboardingResidents.mockResolvedValue([optedIn])
    sendTenantWelcomeSms.mockResolvedValue({ ok: true, configured: true, failed: 0 })

    const result = await completeOnboarding(validOnboardingState(), [], [optedIn])

    expect(result.ok).toBe(true)
    expect(sendTenantWelcomeSms).toHaveBeenCalledWith(
      expect.objectContaining({
        landlordId: TEST_LANDLORD_ID,
        residentId: 'res-opt-in',
      }),
    )
    expect(recordActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          tenants_welcome_sent: 1,
          tenants_pending_outreach: 0,
          message: expect.stringMatching(/Welcome texts were sent to 1 resident/i),
        }),
      }),
    )
  })

  it('does not complete when required setup is missing', async () => {
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
        backupContactEmail: '',
        },
      }),
      [sampleVendor()],
      [sampleResident()],
    )

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Missing/)
    expect(saveLandlordOnboardingConfirmed).not.toHaveBeenCalled()
    expect(recordActivityLog).not.toHaveBeenCalled()
  })
})
