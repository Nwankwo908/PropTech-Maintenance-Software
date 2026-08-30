import { describe, expect, it } from 'vitest'
import {
  VENDOR_ONBOARDING_OVERRIDE_DISCLAIMER_VERSION,
  vendorOnboardingOverrideDisclaimerText,
} from './vendorOnboardingOverrideAck'

describe('vendorOnboardingOverrideDisclaimerText', () => {
  it('uses the v2 skip-onboarding acknowledgement', () => {
    expect(VENDOR_ONBOARDING_OVERRIDE_DISCLAIMER_VERSION).toBe('ulo-vendor-override-ack-v2')
    expect(vendorOnboardingOverrideDisclaimerText('FreshNest Cleaning')).toBe(
      'I have selected this vendor and take full responsibility for their work. Ulo does not verify or screen vendors I add and is not liable for their performance, workmanship, or any damages. (Links to Terms Section 6.2 & Section 10)',
    )
  })
})
