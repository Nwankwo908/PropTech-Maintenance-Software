/** Immutable copy id for the override-onboarding liability acknowledgement. */
export const VENDOR_ONBOARDING_OVERRIDE_DISCLAIMER_VERSION = 'ulo-vendor-override-ack-v2'

export const TERMS_SECTION_6_2_HREF = '/terms#6-2'
export const TERMS_SECTION_10_HREF = '/terms#terms-indemnification'

const DISCLAIMER_BODY =
  'I have selected this vendor and take full responsibility for their work. Ulo does not verify or screen vendors I add and is not liable for their performance, workmanship, or any damages.'

export const VENDOR_ONBOARDING_OVERRIDE_DISCLAIMER_BODY = DISCLAIMER_BODY

/** Exact text persisted on `vendor_onboarding_override_acks`. */
export function vendorOnboardingOverrideDisclaimerText(_vendorName?: string): string {
  return `${DISCLAIMER_BODY} (Links to Terms Section 6.2 & Section 10)`
}
