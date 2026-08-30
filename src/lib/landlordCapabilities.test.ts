import { describe, expect, it } from 'vitest'
import {
  LIMITED_ALPHA_1_LANDLORD_ID,
  isPaymentGraphEventType,
  landlordHasPayments,
  landlordHasVendorMarketplace,
  landlordUsesTwilioSms,
  shouldRecordGraphEvent,
} from '@shared/landlordCapabilities'

describe('Limited Alpha 1 capabilities', () => {
  it('turns off payments but keeps Find External Vendor', () => {
    expect(landlordHasPayments(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(false)
    expect(landlordHasVendorMarketplace(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(landlordHasPayments('068daf53-07e4-4493-bd7f-6106e3c8c62f')).toBe(true)
    expect(landlordUsesTwilioSms(LIMITED_ALPHA_1_LANDLORD_ID)).toBe(true)
    expect(landlordUsesTwilioSms('068daf53-07e4-4493-bd7f-6106e3c8c62f')).toBe(false)
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
