import { describe, expect, it } from 'vitest'
import { inboxParticipantKind, inboxPhoneDigits } from '@/lib/communicationInboxKind'

describe('inboxPhoneDigits', () => {
  it('matches E.164 to local 10-digit numbers', () => {
    expect(inboxPhoneDigits('+1 (512) 555-0199')).toBe('5125550199')
    expect(inboxPhoneDigits('5125550199')).toBe('5125550199')
  })
})

describe('inboxParticipantKind', () => {
  it('uses vendor_alert as vendor', () => {
    expect(inboxParticipantKind({ conversationType: 'vendor_alert' })).toBe('vendor')
  })

  it('treats leftover resident_intake as vendor when the roster matches', () => {
    expect(
      inboxParticipantKind({
        conversationType: 'resident_intake',
        hasVendorId: true,
      }),
    ).toBe('vendor')
    expect(
      inboxParticipantKind({
        conversationType: 'resident_intake',
        matchedVendorByPhone: true,
      }),
    ).toBe('vendor')
    expect(
      inboxParticipantKind({
        conversationType: 'resident_intake',
        matchedVendorByName: true,
      }),
    ).toBe('vendor')
  })

  it('treats vendor verification copy as vendor even without vendor_id', () => {
    expect(
      inboxParticipantKind({
        conversationType: 'resident_intake',
        hasVendorOnboardingCopy: true,
      }),
    ).toBe('vendor')
  })

  it('keeps tenants as tenant', () => {
    expect(inboxParticipantKind({ conversationType: 'resident_intake' })).toBe('tenant')
  })
})
