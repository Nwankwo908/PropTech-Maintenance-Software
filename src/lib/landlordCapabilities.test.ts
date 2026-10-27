import { describe, expect, it } from 'vitest'
import {
  EMPTY_LANDLORD_ID,
  FULL_ALPHA_LANDLORD_ID,
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
  LIMITED_ALPHA_1_TWILIO_SMS_NUMBER,
  isLimitedAlpha1Landlord,
  isLimitedAlpha2Landlord,
  isLimitedAlphaLandlord,
  isOnboardingLandlordId,
  isPaymentGraphEventType,
  isRetiredLandlordAccountId,
  isRetiredSmsIntakeNumber,
  isUloPlatformSmsNumber,
  isLimitedAlphaTwilioSmsNumber,
  isTemporarySharedAlphaLineLandlord,
  landlordHasPayments,
  landlordMayUseSharedAlphaLine,
  landlordBlocksExternalVendorOutreach,
  landlordHasVendorMarketplace,
  landlordUsesTwilioSms,
  pickSettingsTestSmsDestination,
  resolveSmsIntakeNumber,
  shouldRecordGraphEvent,
} from '@shared/landlordCapabilities'

describe('Limited Alpha 1 capabilities', () => {
  it('distinguishes Alpha 1 vs Alpha 2 vs shared limited-alpha', () => {
    expect(isLimitedAlpha1Landlord(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(isLimitedAlpha1Landlord(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(false)
    expect(isLimitedAlpha2Landlord(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(true)
    expect(isLimitedAlpha2Landlord(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    expect(isLimitedAlphaLandlord(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(isLimitedAlphaLandlord(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(true)
  })

  it('turns off payments but keeps Find External Vendor', () => {
    expect(landlordHasPayments(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    expect(landlordHasVendorMarketplace(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(landlordHasPayments(FULL_ALPHA_LANDLORD_ID)).toBe(true)
    expect(landlordUsesTwilioSms(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(landlordUsesTwilioSms(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(true)
    expect(isUloPlatformSmsNumber('+18775803356')).toBe(true)
    expect(isLimitedAlphaTwilioSmsNumber('+18775803356')).toBe(true)
    expect(isRetiredSmsIntakeNumber('+19734005760')).toBe(true)
    expect(resolveSmsIntakeNumber({
      landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
      phone: '+19734005760',
    })).toBe(LIMITED_ALPHA_1_TWILIO_SMS_NUMBER)
    expect(resolveSmsIntakeNumber({
      landlordId: LIMITED_ALPHA_2_LANDLORD_ID,
      phone: '+19734005760',
    })).toBe(LIMITED_ALPHA_1_TWILIO_SMS_NUMBER)
    expect(resolveSmsIntakeNumber({
      phone: '+19734005760',
    })).toBe(LIMITED_ALPHA_1_TWILIO_SMS_NUMBER)
    expect(isUloPlatformSmsNumber('+19734005760')).toBe(true)
    expect(isUloPlatformSmsNumber('+12025550111')).toBe(false)
    expect(pickSettingsTestSmsDestination(['+18775803356', '202-555-0111'])).toBe('+12025550111')
    expect(pickSettingsTestSmsDestination(['+19734005760'])).toBe(null)
    expect(
      pickSettingsTestSmsDestination(['+19088843069', '202-555-0111'], {
        exclude: ['+19088843069'],
      }),
    ).toBe('+12025550111')
    expect(landlordHasPayments(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(false)
    expect(isOnboardingLandlordId(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(true)
    expect(isRetiredLandlordAccountId(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(false)
  })

  it('retires Full Alpha, New Landlord, and Demo from onboarding scope', () => {
    expect(isOnboardingLandlordId(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(isOnboardingLandlordId(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(true)
    expect(isOnboardingLandlordId(FULL_ALPHA_LANDLORD_ID)).toBe(false)
    expect(isOnboardingLandlordId(EMPTY_LANDLORD_ID)).toBe(false)
    expect(isOnboardingLandlordId('de300000-0000-4000-8000-000000000001')).toBe(false)
    expect(isOnboardingLandlordId('de300000-0000-4000-8000-0000000000a1')).toBe(true)
    expect(landlordHasPayments('de300000-0000-4000-8000-0000000000a1')).toBe(false)
    expect(isLimitedAlphaLandlord('de300000-0000-4000-8000-0000000000a1')).toBe(false)
    expect(isRetiredLandlordAccountId(FULL_ALPHA_LANDLORD_ID)).toBe(true)
    expect(isRetiredLandlordAccountId(EMPTY_LANDLORD_ID)).toBe(true)
    expect(isRetiredLandlordAccountId(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('classifies payment graph events', () => {
    expect(isPaymentGraphEventType('payment.landlord_connect_ready')).toBe(true)
    expect(isPaymentGraphEventType('rent.payment_received')).toBe(true)
    expect(isPaymentGraphEventType('rent.ledger_updated')).toBe(false)
    expect(isPaymentGraphEventType('rent.reminder_sent')).toBe(false)
    expect(isPaymentGraphEventType('vendor.assigned')).toBe(false)
  })

  it('skips writing payment events for Limited Alpha 1', () => {
    expect(
      shouldRecordGraphEvent({
        landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
        eventType: 'rent.payment_received',
      }),
    ).toBe(false)
    // Off-platform landlord-confirmed rent bookkeeping still records.
    expect(
      shouldRecordGraphEvent({
        landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
        eventType: 'rent.ledger_updated',
      }),
    ).toBe(true)
    expect(
      shouldRecordGraphEvent({
        landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
        eventType: 'vendor.assigned',
      }),
    ).toBe(true)
  })
})

describe('temporary shared Alpha line access', () => {
  const testLandlord = 'd15a0000-0000-4000-8000-000000000001'
  const otherDisposable = 'd15a0000-0000-4000-8000-000000000099'

  it('lets only the maintenance test landlord use the shared number', () => {
    expect(isTemporarySharedAlphaLineLandlord(testLandlord)).toBe(true)
    expect(isTemporarySharedAlphaLineLandlord(otherDisposable)).toBe(false)
    expect(landlordMayUseSharedAlphaLine(testLandlord)).toBe(true)
    expect(landlordMayUseSharedAlphaLine(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(landlordMayUseSharedAlphaLine(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(true)
    expect(landlordMayUseSharedAlphaLine('de300000-0000-4000-8000-000000000001')).toBe(true)
    expect(landlordMayUseSharedAlphaLine(FULL_ALPHA_LANDLORD_ID)).toBe(false)
    expect(isLimitedAlphaLandlord(testLandlord)).toBe(false)
    expect(landlordHasPayments(testLandlord)).toBe(true)
    expect(resolveSmsIntakeNumber({ landlordId: testLandlord })).toBe(LIMITED_ALPHA_1_TWILIO_SMS_NUMBER)
    expect(landlordBlocksExternalVendorOutreach(testLandlord)).toBe(true)
    expect(landlordBlocksExternalVendorOutreach(otherDisposable)).toBe(false)
    expect(landlordBlocksExternalVendorOutreach(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    expect(landlordBlocksExternalVendorOutreach(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(false)
  })
})

describe('self-service Limited Alpha profiles', () => {
  const first = 'a13a0000-1234-4567-89ab-123456789abc'
  const second = 'a13a0000-5678-4abc-9123-123456789abc'
  it('allows each private profile to onboard with operational features and payments off', () => {
    for (const id of [first, second]) {
      expect(isLimitedAlphaLandlord(id)).toBe(true)
      expect(isOnboardingLandlordId(id)).toBe(true)
      expect(landlordHasVendorMarketplace(id)).toBe(true)
      expect(landlordUsesTwilioSms(id)).toBe(true)
      expect(landlordHasPayments(id)).toBe(false)
    }
  })
  it('does not expand seeded-account identity checks or accept malformed namespaces', () => {
    expect(isLimitedAlpha1Landlord(first)).toBe(false)
    expect(isLimitedAlpha2Landlord(first)).toBe(false)
    expect(isLimitedAlphaLandlord('a13a0000-not-a-uuid')).toBe(false)
    expect(isOnboardingLandlordId('068daf53-07e4-4493-bd7f-6106e3c8c62f')).toBe(false)
  })
})
