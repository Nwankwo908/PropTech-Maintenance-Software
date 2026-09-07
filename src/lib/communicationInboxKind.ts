export type InboxParticipantKind = 'tenant' | 'vendor' | 'ai' | 'landlord'

/** Last 10 digits so +1 and local formats match. */
export function inboxPhoneDigits(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length >= 10) return digits.slice(-10)
  return digits
}

/**
 * Messages list chip: who the thread is with.
 * Vendor roster / invite copy wins over a leftover resident_intake type.
 */
export function inboxParticipantKind(input: {
  conversationType: string
  hasVendorId?: boolean
  matchedVendorByPhone?: boolean
  matchedVendorByName?: boolean
  hasVendorOnboardingCopy?: boolean
  isVendorSetupInbox?: boolean
}): InboxParticipantKind {
  if (input.isVendorSetupInbox) return 'vendor'

  const conversationType = input.conversationType.trim()
  if (conversationType === 'ai_copilot') return 'ai'
  if (conversationType === 'landlord_update') return 'landlord'

  const isVendor =
    Boolean(input.hasVendorId) ||
    Boolean(input.matchedVendorByPhone) ||
    Boolean(input.matchedVendorByName) ||
    Boolean(input.hasVendorOnboardingCopy)

  if (conversationType === 'vendor_alert') return 'vendor'
  if (conversationType === 'vendor_tenant_proxy') {
    return isVendor ? 'vendor' : 'tenant'
  }
  if (isVendor) return 'vendor'
  return 'tenant'
}
