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
  landlordHasPayments,
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
    expect(isRetiredLandlordAccountId(FULL_ALPHA_LANDLORD_ID)).toBe(true)
    expect(isRetiredLandlordAccountId(EMPTY_LANDLORD_ID)).toBe(true)
    expect(isRetiredLandlordAccountId(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
  })

  it('classifies payment graph events', () => {
    expect(isPaymentGraphEventType('payment.landlord_connect_ready')).toBe(true)
    expect(isPaymentGraphEventType('rent.payment_received')).toBe(true)
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
    expect(
      shouldRecordGraphEvent({
        landlordId: LIMITED_ALPHA_1_LANDLORD_ID,
        eventType: 'vendor.assigned',
      }),
    ).toBe(true)
  })
})
