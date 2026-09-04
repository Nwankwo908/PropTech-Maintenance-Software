import { beforeEach, describe, expect, it } from 'vitest'
import { LIMITED_ALPHA_1_LANDLORD_ID } from '@shared/landlordCapabilities'
import {
  clearSetupSuccessCardDismissed,
  dismissSetupSuccessCard,
  isSetupSuccessCardDismissed,
  resolveSetupSuccessProgress,
  setupSuccessPercent,
  welcomeTextsComplete,
} from './setupSuccessChecklist'

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

  it('marks invite vendors complete after at least one vendor is added', () => {
    expect(
      resolveSetupSuccessProgress({
        residents: [],
        vendorCount: 0,
        verifiedVendorCount: 0,
        propertyDetailsComplete: false,
        hasMaintenancePreferences: false,
        maintenanceRequestCount: 0,
      }).items.find((item) => item.id === 'verify_vendors')?.done,
    ).toBe(false)
    expect(
      resolveSetupSuccessProgress({
        residents: [],
        vendorCount: 1,
        verifiedVendorCount: 0,
        propertyDetailsComplete: false,
        hasMaintenancePreferences: false,
        maintenanceRequestCount: 0,
      }).items.find((item) => item.id === 'verify_vendors')?.done,
    ).toBe(true)
  })

  it('counts completed steps for the progress bar', () => {
    const progress = resolveSetupSuccessProgress({
      residents: [{ phone: '2015550100', activationStatus: 'waiting' }],
      vendorCount: 1,
      verifiedVendorCount: 0,
      propertyDetailsComplete: true,
      hasMaintenancePreferences: true,
      maintenanceRequestCount: 0,
    })
    expect(progress.total).toBe(5)
    expect(progress.doneCount).toBe(4)
    expect(progress.items.map((item) => [item.id, item.done])).toEqual([
      ['welcome_texts', true],
      ['verify_vendors', true],
      ['property_details', true],
      ['maintenance_prefs', true],
      ['test_request', false],
    ])
  })

  it('does not check property details until every property section is filled', () => {
    const progress = resolveSetupSuccessProgress({
      residents: [],
      vendorCount: 0,
      verifiedVendorCount: 0,
      propertyDetailsComplete: false,
      hasMaintenancePreferences: false,
      maintenanceRequestCount: 0,
    })
    expect(progress.items.find((item) => item.id === 'property_details')?.done).toBe(false)
    expect(progress.items.find((item) => item.id === 'property_details')?.label).toBe(
      'Property details',
    )
  })

  it('remembers when the setup card is closed until onboarding reset', () => {
    expect(isSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    dismissSetupSuccessCard(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    clearSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessCardDismissed(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('reports percent complete for the collapsed nav hint', () => {
    const progress = resolveSetupSuccessProgress({
      residents: [{ phone: '2015550100', activationStatus: 'waiting' }],
      vendorCount: 1,
      verifiedVendorCount: 1,
      propertyDetailsComplete: false,
      hasMaintenancePreferences: false,
      maintenanceRequestCount: 0,
    })
    expect(setupSuccessPercent(progress)).toBe(40)
  })
})
