import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LIMITED_ALPHA_1_LANDLORD_ID } from '@shared/landlordCapabilities'
import {
  clearSetupSuccessCheckboxGuide,
  dismissSetupSuccessCheckboxGuide,
  isSetupSuccessCheckboxGuideActive,
  isSetupSuccessCheckboxGuideNavigation,
  markSetupSuccessCheckboxGuidePending,
  setupCheckboxGuideLinkState,
  setupCheckboxGuidePropertyTabState,
  shouldShowSetupSuccessCheckboxGuide,
} from './setupSuccessGuide'

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

describe('setupSuccessGuide', () => {
  beforeEach(() => {
    memory.clear()
  })

  afterEach(() => {
    clearSetupSuccessCheckboxGuide(LIMITED_ALPHA_1_LANDLORD_ID)
  })

  it('arms the residents guide after welcome texts', () => {
    expect(shouldShowSetupSuccessCheckboxGuide('residents', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    expect(shouldShowSetupSuccessCheckboxGuide('vendors', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)

    markSetupSuccessCheckboxGuidePending('welcome_texts', LIMITED_ALPHA_1_LANDLORD_ID)
    expect(shouldShowSetupSuccessCheckboxGuide('residents', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(shouldShowSetupSuccessCheckboxGuide('vendors', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('attaches coachmark navigation state to welcome texts and verify vendors', () => {
    expect(setupCheckboxGuideLinkState('welcome_texts')).toEqual({ setupCheckboxGuide: 'residents' })
    expect(setupCheckboxGuideLinkState('verify_vendors')).toEqual({ setupCheckboxGuide: 'vendors' })
    expect(setupCheckboxGuideLinkState('property_details')).toEqual({
      setupCheckboxGuide: 'properties',
    })
    expect(setupCheckboxGuideLinkState('test_request')).toEqual({
      setupCheckboxGuide: 'test_delivery',
    })
    expect(isSetupSuccessCheckboxGuideNavigation({ setupCheckboxGuide: 'residents' }, 'residents')).toBe(
      true,
    )
    expect(isSetupSuccessCheckboxGuideNavigation({ setupCheckboxGuide: 'vendors' }, 'vendors')).toBe(true)
    expect(isSetupSuccessCheckboxGuideNavigation({ setupCheckboxGuide: 'residents' }, 'vendors')).toBe(
      false,
    )
    expect(isSetupSuccessCheckboxGuideNavigation({}, 'residents')).toBe(false)
    expect(setupCheckboxGuidePropertyTabState()).toEqual({ setupCheckboxGuide: 'property_tab' })
    expect(
      isSetupSuccessCheckboxGuideNavigation({ setupCheckboxGuide: 'property_tab' }, 'property_tab'),
    ).toBe(true)
    expect(
      isSetupSuccessCheckboxGuideNavigation({ setupCheckboxGuide: 'properties' }, 'property_tab'),
    ).toBe(false)
  })

  it('arms the vendors guide after verify vendors', () => {
    markSetupSuccessCheckboxGuidePending('verify_vendors', LIMITED_ALPHA_1_LANDLORD_ID)
    expect(shouldShowSetupSuccessCheckboxGuide('vendors', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(shouldShowSetupSuccessCheckboxGuide('residents', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('arms the properties guide after property details', () => {
    markSetupSuccessCheckboxGuidePending('property_details', LIMITED_ALPHA_1_LANDLORD_ID)
    expect(shouldShowSetupSuccessCheckboxGuide('properties', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(shouldShowSetupSuccessCheckboxGuide('vendors', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    expect(shouldShowSetupSuccessCheckboxGuide('residents', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('ignores unrelated setup steps', () => {
    markSetupSuccessCheckboxGuidePending('maintenance_prefs', LIMITED_ALPHA_1_LANDLORD_ID)
    expect(shouldShowSetupSuccessCheckboxGuide('vendors', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    expect(shouldShowSetupSuccessCheckboxGuide('residents', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    expect(shouldShowSetupSuccessCheckboxGuide('properties', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('arms the test-delivery guide after submit a test maintenance request', () => {
    markSetupSuccessCheckboxGuidePending('test_request', LIMITED_ALPHA_1_LANDLORD_ID)
    expect(shouldShowSetupSuccessCheckboxGuide('test_delivery', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(shouldShowSetupSuccessCheckboxGuide('properties', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('treats a pending storage flag as an active coachmark even without router state', () => {
    markSetupSuccessCheckboxGuidePending('welcome_texts', LIMITED_ALPHA_1_LANDLORD_ID)
    expect(isSetupSuccessCheckboxGuideActive(null, 'residents')).toBe(true)
    expect(isSetupSuccessCheckboxGuideActive(null, 'vendors')).toBe(false)
  })

  it('dismisses the residents guide after checkbox interaction', () => {
    markSetupSuccessCheckboxGuidePending('welcome_texts', LIMITED_ALPHA_1_LANDLORD_ID)
    dismissSetupSuccessCheckboxGuide('residents', LIMITED_ALPHA_1_LANDLORD_ID)
    expect(shouldShowSetupSuccessCheckboxGuide('residents', LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })
})
