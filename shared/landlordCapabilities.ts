/**
 * Per-account product capabilities.
 *
 * Limited Alpha accounts are empty new-user landlords without payments, bank
 * linking, or native-app channels. Find External Vendor is on — there is often
 * no matching in-network trade.
 */

export const LIMITED_ALPHA_1_LANDLORD_ID = 'de300000-0000-4000-8000-000000000003'
export const LIMITED_ALPHA_2_LANDLORD_ID = 'de300000-0000-4000-8000-000000000004'
export const FULL_ALPHA_LANDLORD_ID = '068daf53-07e4-4493-bd7f-6106e3c8c62f'
export const EMPTY_LANDLORD_ID = 'de300000-0000-4000-8000-000000000002'

export const LIMITED_ALPHA_LANDLORD_IDS = [
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
] as const

/** Retired portal accounts — not selectable and not used as the default scope. */
export function isRetiredLandlordAccountId(landlordId: string | null | undefined): boolean {
  const id = (landlordId ?? '').trim()
  return id === FULL_ALPHA_LANDLORD_ID || id === EMPTY_LANDLORD_ID
}

/** Landlord ids allowed to run setup + fast-track document extract. */
export const ONBOARDING_LANDLORD_IDS = LIMITED_ALPHA_LANDLORD_IDS

export function isOnboardingLandlordId(landlordId: string | null | undefined): boolean {
  const id = (landlordId ?? '').trim()
  return (ONBOARDING_LANDLORD_IDS as readonly string[]).includes(id)
}

export function isLimitedAlphaLandlord(landlordId: string | null | undefined): boolean {
  const id = (landlordId ?? '').trim()
  return (LIMITED_ALPHA_LANDLORD_IDS as readonly string[]).includes(id)
}

/** @deprecated Prefer isLimitedAlphaLandlord — kept for existing call sites. */
export function isLimitedAlpha1Landlord(landlordId: string | null | undefined): boolean {
  return isLimitedAlphaLandlord(landlordId)
}

/** Production Twilio DID used as Limited Alpha 1 and 2's shared landlord_main line. */
export const LIMITED_ALPHA_1_TWILIO_SMS_NUMBER = '+18775803356'

/** Production Telnyx DID (Full Alpha / platform). Not used for Limited Alpha. */
export const ULO_TELNYX_SMS_NUMBER = '+19734005760'

function smsDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '')
}

/** E.164 for US 10/11 digit numbers. */
export function normalizeUsSmsPhone(input: string | null | undefined): string | null {
  const digits = smsDigits(input)
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length > 11) return `+${digits}`
  return null
}

/** Ulo landlord lines — never use these as a test-SMS destination. */
export function isUloPlatformSmsNumber(phone: string | null | undefined): boolean {
  const digits = smsDigits(phone)
  if (!digits) return false
  const platform = [LIMITED_ALPHA_1_TWILIO_SMS_NUMBER, ULO_TELNYX_SMS_NUMBER].map(smsDigits)
  return platform.some((n) => digits === n || digits === n.slice(-10))
}

/** Shared Limited Alpha Twilio DID (+18775803356). */
export function isLimitedAlphaTwilioSmsNumber(phone: string | null | undefined): boolean {
  const digits = smsDigits(phone)
  if (!digits) return false
  const twilio = smsDigits(LIMITED_ALPHA_1_TWILIO_SMS_NUMBER)
  return digits === twilio || digits === twilio.slice(-10)
}

/** First usable personal/account phone — never a Ulo platform DID. */
export function pickSettingsTestSmsDestination(
  phones: Array<string | null | undefined>,
  options?: { exclude?: Array<string | null | undefined> },
): string | null {
  const excluded = new Set<string>()
  for (const raw of options?.exclude ?? []) {
    const normalized = normalizeUsSmsPhone(raw)
    if (normalized) excluded.add(normalized)
  }
  for (const raw of phones) {
    const normalized = normalizeUsSmsPhone(raw)
    if (
      normalized &&
      !isUloPlatformSmsNumber(normalized) &&
      !excluded.has(normalized)
    ) {
      return normalized
    }
  }
  return null
}

/** Limited Alpha 1 and 2 send and receive on the shared Twilio DID. */
export function landlordUsesTwilioSms(landlordId: string | null | undefined): boolean {
  return isLimitedAlphaLandlord(landlordId)
}

/** Stripe, ACH, Plaid, rent/invoice checkout, vendor payouts, and “pay online” links.
 *  Limited Alpha still records rent by landlord SMS (received / unpaid) without moving money. */
export function landlordHasPayments(landlordId: string | null | undefined): boolean {
  return !isLimitedAlphaLandlord(landlordId)
}

/** Find External Vendor / Ulo-vetted marketplace dispatch. */
export function landlordHasVendorMarketplace(_landlordId: string | null | undefined): boolean {
  return true
}

/** Push / native-app notification channels. */
export function landlordHasNativeMobileApp(landlordId: string | null | undefined): boolean {
  return !isLimitedAlphaLandlord(landlordId)
}

/** Accounting, bank reconciliation, and related document discovery. */
export function landlordHasAccounting(landlordId: string | null | undefined): boolean {
  return !isLimitedAlphaLandlord(landlordId)
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
