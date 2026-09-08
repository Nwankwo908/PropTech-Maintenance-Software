import { describe, expect, it } from 'vitest'
import {
  EMPTY_LANDLORD_ID,
  FULL_ALPHA_LANDLORD_ID,
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
  isOnboardingLandlordId,
  isPaymentGraphEventType,
  isRetiredLandlordAccountId,
  landlordHasPayments,
  landlordHasVendorMarketplace,
  landlordUsesTwilioSms,
  shouldRecordGraphEvent,
} from '@shared/landlordCapabilities'

describe('Limited Alpha 1 capabilities', () => {
  it('turns off payments but keeps Find External Vendor', () => {
    expect(landlordHasPayments(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    expect(landlordHasVendorMarketplace(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(landlordHasPayments(FULL_ALPHA_LANDLORD_ID)).toBe(true)
    expect(landlordUsesTwilioSms(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(landlordUsesTwilioSms(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(false)
    expect(landlordHasPayments(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(false)
    expect(isOnboardingLandlordId(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(true)
    expect(isRetiredLandlordAccountId(LIMITED_ALPHA_2_LANDLORD_ID)).toBe(false)
  })

  it('retires Full Alpha and New Landlord from onboarding and default scope', () => {
    expect(isOnboardingLandlordId(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(isOnboardingLandlordId(FULL_ALPHA_LANDLORD_ID)).toBe(false)
    expect(isOnboardingLandlordId(EMPTY_LANDLORD_ID)).toBe(false)
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
