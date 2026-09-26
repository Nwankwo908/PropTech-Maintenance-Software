import { beforeEach, describe, expect, it } from 'vitest'
import { LIMITED_ALPHA_1_LANDLORD_ID } from '@shared/landlordCapabilities'
import { markLimitedAlphaPostOnboardingWelcomeSeen } from './postOnboardingWelcome'
import {
  clearSetupSuccessCardDismissed,
  clearSetupSuccessNavPercentBaseline,
  clearSetupSuccessTestDelivery,
  dismissSetupSuccessCard,
  isSetupSuccessCardDismissed,
  isSetupSuccessTestDeliveryComplete,
  markSetupSuccessTestDeliveryComplete,
  resolveSetupSuccessProgress,
  setupSuccessNavPercentGain,
  setupSuccessPercent,
  shouldShowSetupSuccessNavHint,
  welcomeTextsComplete,
} from './setupSuccessChecklist'

function progressInput(
  overrides: Partial<Parameters<typeof resolveSetupSuccessProgress>[0]> = {},
): Parameters<typeof resolveSetupSuccessProgress>[0] {
  return {
    residents: [],
    vendorCount: 0,
    vendorOutreachStartedCount: 0,
    propertyAccessComplete: false,
    propertyIntelligenceComplete: false,
    propertyInsuranceComplete: false,
    hasMaintenancePreferences: false,
    maintenanceRequestCount: 0,
    ...overrides,
  }
}

const memory = new Map<string, string>()
const localStorageMock = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value)
  },
  removeItem: (key: string) => {
    memory.delete(key)
  },
  clear: () => {
    memory.clear()
  },
}
Object.defineProperty(globalThis, 'window', {
  value: { localStorage: localStorageMock },
  configurable: true,
})

describe('setupSuccessChecklist', () => {
  beforeEach(() => {
    memory.clear()
  })
  it('marks welcome texts complete after at least one tenant onboarding starts', () => {
    expect(welcomeTextsComplete([])).toBe(false)
    expect(
      welcomeTextsComplete([
        { phone: '2015550100', activationStatus: 'not_started' },
        { phone: '2015550101', activationStatus: 'not_started' },
      ]),
    ).toBe(false)
    expect(
      welcomeTextsComplete([
        { phone: '2015550100', activationStatus: 'not_started' },
        { phone: '2015550101', activationStatus: 'waiting' },
      ]),
    ).toBe(true)
    expect(
      welcomeTextsComplete([{ phone: '2015550100', activationStatus: 'activated' }]),
    ).toBe(true)
  })

  it('marks invite vendors complete after outreach starts, not roster alone', () => {
    expect(
      resolveSetupSuccessProgress(progressInput()).items.find((item) => item.id === 'verify_vendors')
        ?.done,
    ).toBe(false)
    expect(
      resolveSetupSuccessProgress(progressInput({ vendorCount: 1 })).items.find(
        (item) => item.id === 'verify_vendors',
      )?.done,
    ).toBe(false)
    expect(
      resolveSetupSuccessProgress(
        progressInput({ vendorCount: 1, vendorOutreachStartedCount: 1 }),
      ).items.find((item) => item.id === 'verify_vendors')?.done,
    ).toBe(true)
  })

  it('counts completed steps for the progress bar', () => {
    const progress = resolveSetupSuccessProgress(
      progressInput({
        residents: [{ phone: '2015550100', activationStatus: 'waiting' }],
        vendorCount: 1,
        vendorOutreachStartedCount: 1,
        propertyAccessComplete: true,
        propertyIntelligenceComplete: true,
        propertyInsuranceComplete: true,
        hasMaintenancePreferences: true,
      }),
    )
    expect(progress.total).toBe(7)
    expect(progress.doneCount).toBe(6)
    expect(progress.items.map((item) => [item.id, item.done])).toEqual([
      ['welcome_texts', true],
      ['verify_vendors', true],
      ['property_access', true],
      ['property_intelligence', true],
      ['property_insurance', true],
      ['maintenance_prefs', true],
      ['test_request', false],
    ])
  })

  it('sends the test request step to Notifications Test delivery', () => {
    const item = resolveSetupSuccessProgress(progressInput()).items.find(
      (row) => row.id === 'test_request',
    )
    expect(item?.to).toBe('/admin/settings/operations/notifications#test-delivery')
    expect(item?.to.includes('/request')).toBe(false)
  })

  it('checks off the test request after Test delivery is used', () => {
    expect(
      resolveSetupSuccessProgress(progressInput({ hasTestDelivery: true })).items.find(
        (item) => item.id === 'test_request',
      )?.done,
    ).toBe(true)
    markSetupSuccessTestDeliveryComplete(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessTestDeliveryComplete(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    clearSetupSuccessTestDelivery(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessTestDeliveryComplete(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('tracks property access, intelligence, and insurance separately', () => {
    const progress = resolveSetupSuccessProgress(progressInput())
    expect(progress.items.find((item) => item.id === 'property_details')).toBeUndefined()
    expect(progress.items.find((item) => item.id === 'property_access')).toMatchObject({
      label: 'Set up property access',
      done: false,
    })
    expect(progress.items.find((item) => item.id === 'property_intelligence')).toMatchObject({
      label: 'Add property details',
      done: false,
    })
    expect(progress.items.find((item) => item.id === 'property_insurance')).toMatchObject({
      label: 'Add insurance details',
      done: false,
    })
    const filled = resolveSetupSuccessProgress(
      progressInput({
        propertyAccessComplete: true,
        propertyIntelligenceComplete: true,
        propertyInsuranceComplete: true,
      }),
    )
    expect(filled.items.find((item) => item.id === 'property_access')?.done).toBe(true)
    expect(filled.items.find((item) => item.id === 'property_intelligence')?.done).toBe(true)
    expect(filled.items.find((item) => item.id === 'property_insurance')?.done).toBe(true)
  })

  it('remembers when the setup card is closed until onboarding reset', () => {
    expect(isSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    dismissSetupSuccessCard(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    clearSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('reports percent complete for the collapsed nav hint', () => {
    const progress = resolveSetupSuccessProgress(
      progressInput({
        residents: [{ phone: '2015550100', activationStatus: 'waiting' }],
        vendorCount: 1,
        vendorOutreachStartedCount: 1,
      }),
    )
    expect(setupSuccessPercent(progress)).toBe(29)
  })

  it('keeps the Profile setup nav hint until checklist is complete even if the card is open', () => {
    markLimitedAlphaPostOnboardingWelcomeSeen(LIMITED_ALPHA_1_LANDLORD_ID)
    clearSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)
    const incomplete = resolveSetupSuccessProgress(progressInput())
    expect(shouldShowSetupSuccessNavHint(incomplete, LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(shouldShowSetupSuccessNavHint(incomplete, LIMITED_ALPHA_2_LANDLORD_ID)).toBe(false)
    markLimitedAlphaPostOnboardingWelcomeSeen(LIMITED_ALPHA_2_LANDLORD_ID)
    expect(shouldShowSetupSuccessNavHint(incomplete, LIMITED_ALPHA_2_LANDLORD_ID)).toBe(true)
    const complete = resolveSetupSuccessProgress(
      progressInput({
        residents: [{ phone: '2015550100', activationStatus: 'waiting' }],
        vendorCount: 1,
        vendorOutreachStartedCount: 1,
        propertyAccessComplete: true,
        propertyIntelligenceComplete: true,
        propertyInsuranceComplete: true,
        hasMaintenancePreferences: true,
        maintenanceRequestCount: 1,
      }),
    )
    expect(complete.doneCount).toBe(complete.total)
    expect(shouldShowSetupSuccessNavHint(complete, LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    expect(shouldShowSetupSuccessNavHint(complete, LIMITED_ALPHA_2_LANDLORD_ID)).toBe(false)
  })

  it('reports positive percent-point gains for the nav flash', () => {
    clearSetupSuccessNavPercentBaseline(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(setupSuccessNavPercentGain(14, LIMITED_ALPHA_1_LANDLORD_ID)).toBe(0)
    expect(setupSuccessNavPercentGain(29, LIMITED_ALPHA_1_LANDLORD_ID)).toBe(15)
    expect(setupSuccessNavPercentGain(29, LIMITED_ALPHA_1_LANDLORD_ID)).toBe(0)
  })
})
