import { beforeEach, describe, expect, it } from 'vitest'
import { LIMITED_ALPHA_1_LANDLORD_ID, LIMITED_ALPHA_2_LANDLORD_ID } from '@shared/landlordCapabilities'
import { markLimitedAlphaPostOnboardingWelcomeSeen } from './postOnboardingWelcome'
import {
  clearSetupSuccessCardDismissed,
  clearSetupSuccessCompleteInformationPrompt,
  isSetupSuccessCompleteInformationPrompt,
  markSetupSuccessCompleteInformationPrompt,
  clearSetupSuccessCardMinimized,
  clearSetupSuccessNavPercentBaseline,
  clearSetupSuccessTestDelivery,
  dismissSetupSuccessCard,
  isSetupSuccessCardDismissed,
  isSetupSuccessCardHidden,
  isSetupSuccessCardMinimized,
  isSetupSuccessTestDeliveryComplete,
  markSetupSuccessTestDeliveryComplete,
  minimizeSetupSuccessCard,
  resolveSetupSuccessProgress,
  setupSuccessNavPercentGain,
  setupSuccessPercent,
  setupSuccessExperienceReady,
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
    missingTradeCount: 8,
    propertyCount: 0,
    propertiesMissingAccess: 0,
    propertiesMissingDetails: 0,
    propertiesMissingInsurance: 0,
    hasMaintenancePreferences: false,
    maintenanceRequestCount: 0,
    ...overrides,
  }
}

const memory = new Map<string, string>()
const sessionMemory = new Map<string, string>()
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
const sessionStorageMock = {
  getItem: (key: string) => sessionMemory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    sessionMemory.set(key, value)
  },
  removeItem: (key: string) => {
    sessionMemory.delete(key)
  },
  clear: () => {
    sessionMemory.clear()
  },
}
Object.defineProperty(globalThis, 'window', {
  value: { localStorage: localStorageMock, sessionStorage: sessionStorageMock },
  configurable: true,
})

describe('setupSuccessChecklist', () => {
  beforeEach(() => {
    memory.clear()
    sessionMemory.clear()
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

  it('marks invite vendors complete only when every vendor is invited and every trade is covered', () => {
    expect(
      resolveSetupSuccessProgress(progressInput()).items.find((item) => item.id === 'verify_vendors'),
    ).toMatchObject({ done: false, remaining: 8 })
    expect(
      resolveSetupSuccessProgress(progressInput({ vendorCount: 1 })).items.find(
        (item) => item.id === 'verify_vendors',
      ),
    ).toMatchObject({ done: false, remaining: 9 })
    expect(
      resolveSetupSuccessProgress(
        progressInput({ vendorCount: 1, vendorOutreachStartedCount: 1, missingTradeCount: 0 }),
      ).items.find((item) => item.id === 'verify_vendors'),
    ).toMatchObject({ done: true, remaining: 0 })
  })

  it('puts missing property, vendor, trade, and welcome counts into the percentage', () => {
    const progress = resolveSetupSuccessProgress(
      progressInput({
        residents: [
          { phone: '2015550100', activationStatus: 'waiting' },
          { phone: '2015550101', activationStatus: 'not_started' },
        ],
        vendorCount: 2,
        vendorOutreachStartedCount: 1,
        missingTradeCount: 3,
        propertyCount: 4,
        propertiesMissingAccess: 2,
        propertiesMissingDetails: 1,
        propertiesMissingInsurance: 4,
        hasMaintenancePreferences: true,
      }),
    )
    expect(progress.items.find((item) => item.id === 'welcome_texts')).toMatchObject({
      done: false,
      remaining: 1,
      detail: '1 resident left',
    })
    expect(
      resolveSetupSuccessProgress(
        progressInput({
          residents: Array.from({ length: 8 }, () => ({
            phone: '2015550100',
            activationStatus: 'not_started',
          })),
        }),
      ).items.find((item) => item.id === 'welcome_texts')?.detail,
    ).toBe('8 residents left')
    expect(progress.items.find((item) => item.id === 'verify_vendors')).toMatchObject({
      done: false,
      remaining: 4,
      detail: '1 vendor needs activation, 3 trades left to add',
    })
    expect(progress.items.find((item) => item.id === 'property_access')?.detail).toBe('2 properties left')
    expect(progress.items.find((item) => item.id === 'property_intelligence')?.detail).toBe(
      '1 property left',
    )
    expect(progress.items.find((item) => item.id === 'property_insurance')?.detail).toBe(
      '4 properties left',
    )
    // 1 welcome + 1 invite + 5 trades + 2 access + 3 details + 0 insurance + prefs.
    expect(progress.completedUnits).toBe(13)
    expect(progress.unitTotal).toBe(26)
    expect(setupSuccessPercent(progress)).toBe(50)
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
    expect(progress.items.map((item) => item.id)).not.toContain('property_details')
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
        propertyCount: 2,
        propertiesMissingAccess: 0,
        propertiesMissingDetails: 0,
        propertiesMissingInsurance: 0,
      }),
    )
    expect(filled.items.find((item) => item.id === 'property_access')?.done).toBe(true)
    expect(filled.items.find((item) => item.id === 'property_intelligence')?.done).toBe(true)
    expect(filled.items.find((item) => item.id === 'property_insurance')?.done).toBe(true)
  })

  it('shows the property access prompt only after Complete information', () => {
    expect(isSetupSuccessCompleteInformationPrompt(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    markSetupSuccessCompleteInformationPrompt(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessCompleteInformationPrompt(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    clearSetupSuccessCompleteInformationPrompt(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessCompleteInformationPrompt(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('remembers when the setup card is closed until onboarding reset', () => {
    expect(isSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    dismissSetupSuccessCard(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    clearSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('minimizes for the tab only — not a lasting dismiss', () => {
    clearSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessCardMinimized(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    minimizeSetupSuccessCard(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessCardMinimized(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(isSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    expect(isSetupSuccessCardHidden(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    clearSetupSuccessCardMinimized(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessCardHidden(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('reports percent complete for the collapsed nav hint', () => {
    const progress = resolveSetupSuccessProgress(
      progressInput({
        residents: [{ phone: '2015550100', activationStatus: 'waiting' }],
        vendorCount: 1,
        vendorOutreachStartedCount: 1,
        missingTradeCount: 0,
        propertyCount: 1,
        propertiesMissingAccess: 0,
        propertiesMissingDetails: 0,
        propertiesMissingInsurance: 1,
      }),
    )
    // 1 welcome + 1 invite + 8 trades + access + details + preferences off + test off.
    expect(progress.completedUnits).toBe(12)
    expect(progress.unitTotal).toBe(15)
    expect(setupSuccessPercent(progress)).toBe(80)
  })

  it('keeps the Profile setup nav hint until checklist is complete even if the card is open', () => {
    markLimitedAlphaPostOnboardingWelcomeSeen(LIMITED_ALPHA_1_LANDLORD_ID)
    clearSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)
    const incomplete = resolveSetupSuccessProgress(progressInput())
    expect(shouldShowSetupSuccessNavHint(incomplete, LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(shouldShowSetupSuccessNavHint(incomplete, LIMITED_ALPHA_2_LANDLORD_ID)).toBe(false)
    expect(
      shouldShowSetupSuccessNavHint(incomplete, 'de300000-0000-4000-8000-0000000000a2'),
    ).toBe(true)
    expect(setupSuccessExperienceReady('de300000-0000-4000-8000-0000000000a2')).toBe(true)
    expect(setupSuccessExperienceReady('d15a0000-0000-4000-8000-000000000001')).toBe(true)
    expect(setupSuccessExperienceReady(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(false)
    markLimitedAlphaPostOnboardingWelcomeSeen(LIMITED_ALPHA_2_LANDLORD_ID)
    expect(shouldShowSetupSuccessNavHint(incomplete, LIMITED_ALPHA_2_LANDLORD_ID)).toBe(true)
    const complete = resolveSetupSuccessProgress(
      progressInput({
        residents: [{ phone: '2015550100', activationStatus: 'waiting' }],
        vendorCount: 1,
        vendorOutreachStartedCount: 1,
        missingTradeCount: 0,
        propertyCount: 1,
        propertiesMissingAccess: 0,
        propertiesMissingDetails: 0,
        propertiesMissingInsurance: 0,
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
