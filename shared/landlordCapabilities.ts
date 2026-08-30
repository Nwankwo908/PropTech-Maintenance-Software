/**
 * Per-account product capabilities.
 *
 * Limited Alpha 1 is an empty new-user account without payments, bank linking,
 * or native-app channels. Find External Vendor is on — there is often no
 * matching in-network trade.
 */

export const LIMITED_ALPHA_1_LANDLORD_ID = 'de300000-0000-4000-8000-000000000003'
export const FULL_ALPHA_LANDLORD_ID = '068daf53-07e4-4493-bd7f-6106e3c8c62f'
export const EMPTY_LANDLORD_ID = 'de300000-0000-4000-8000-000000000002'

/** Landlord ids allowed to run setup + fast-track document extract. */
export const ONBOARDING_LANDLORD_IDS = [
  EMPTY_LANDLORD_ID,
  LIMITED_ALPHA_1_LANDLORD_ID,
  FULL_ALPHA_LANDLORD_ID,
] as const

export function isOnboardingLandlordId(landlordId: string | null | undefined): boolean {
  const id = (landlordId ?? '').trim()
  return (ONBOARDING_LANDLORD_IDS as readonly string[]).includes(id)
}

export function isLimitedAlpha1Landlord(landlordId: string | null | undefined): boolean {
  return (landlordId ?? '').trim() === LIMITED_ALPHA_1_LANDLORD_ID
}

/** Production Twilio DID used as Limited Alpha 1's landlord_main line. */
export const LIMITED_ALPHA_1_TWILIO_SMS_NUMBER = '+18775803356'

/** Limited Alpha 1 sends and receives on Twilio; Full Alpha stays on Telnyx. */
export function landlordUsesTwilioSms(landlordId: string | null | undefined): boolean {
  return isLimitedAlpha1Landlord(landlordId)
}

/** Stripe, ACH, Plaid, rent/invoice checkout, vendor payouts. */
export function landlordHasPayments(landlordId: string | null | undefined): boolean {
  return !isLimitedAlpha1Landlord(landlordId)
}

/** Find External Vendor / Ulo-vetted marketplace dispatch. */
export function landlordHasVendorMarketplace(_landlordId: string | null | undefined): boolean {
  return true
}

/** Push / native-app notification channels. */
export function landlordHasNativeMobileApp(landlordId: string | null | undefined): boolean {
  return !isLimitedAlpha1Landlord(landlordId)
}

/** Accounting, bank reconciliation, and related document discovery. */
export function landlordHasAccounting(landlordId: string | null | undefined): boolean {
  return !isLimitedAlpha1Landlord(landlordId)
}

/**
 * Money-movement activity that must not be written or shown for Limited Alpha 1.
 */
export function isPaymentGraphEventType(eventType: string | null | undefined): boolean {
  const t = (eventType ?? '').trim().toLowerCase()
  if (!t) return false
  if (t.startsWith('payment.')) return true
  if (t.startsWith('invoice.')) return true
  if (t.startsWith('stripe.')) return true
  if (t.startsWith('plaid.')) return true
  if (t.includes('invoice_payment')) return true
  if (t === 'payment_received' || t === 'payment_requested' || t === 'payment_failed') return true
  if (t === 'rent.payment_received' || t === 'rent.payment_failed' || t === 'rent.payment_requested') {
    return true
  }
  if (t === 'rent.ledger_updated' || t === 'rent.payment_plan_offered') return true
  if (t === 'maintenance.invoice_paid' || t === 'maintenance.invoice_payment_failed') return true
  if (t.startsWith('landlord.stripe_connect')) return true
  return false
}

export function shouldRecordGraphEvent(params: {
  landlordId: string | null | undefined
  eventType: string | null | undefined
}): boolean {
  if (!landlordHasPayments(params.landlordId) && isPaymentGraphEventType(params.eventType)) {
    return false
  }
  return true
}
