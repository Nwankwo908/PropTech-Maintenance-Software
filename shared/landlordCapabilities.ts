/**
 * Per-account product capabilities.
 *
 * Limited Alpha accounts are empty new-user landlords without payments, bank
 * linking, or native-app channels. Find External Vendor is on — there is often
 * no matching in-network trade.
 *
 * Demo Property Management keeps its own seeded portfolio data, but uses the
 * Limited Alpha product surface (capabilities / gates). Do not scope Demo
 * queries to a Limited Alpha landlord id.
 */

export const DEMO_LANDLORD_ID = 'de300000-0000-4000-8000-000000000001'
export const LIMITED_ALPHA_1_LANDLORD_ID = 'de300000-0000-4000-8000-000000000003'
export const LIMITED_ALPHA_2_LANDLORD_ID = 'de300000-0000-4000-8000-000000000004'
export const FULL_ALPHA_LANDLORD_ID = '068daf53-07e4-4493-bd7f-6106e3c8c62f'
export const EMPTY_LANDLORD_ID = 'de300000-0000-4000-8000-000000000002'

export const LIMITED_ALPHA_LANDLORD_IDS = [
  LIMITED_ALPHA_1_LANDLORD_ID,
  LIMITED_ALPHA_2_LANDLORD_ID,
] as const

/**
 * Empty accounts used only to verify lease import. They are not Limited Alpha 1 or 2.
 * Setup and document extract may run here. Payments stay off.
 */
export const LEASE_IMPORT_TEST_LANDLORD_IDS = [
  'de300000-0000-4000-8000-0000000000a1',
  'de300000-0000-4000-8000-0000000000a2',
  'de300000-0000-4000-8000-0000000000a3',
] as const

/** Retired portal accounts — not selectable and not used as the default scope. */
export function isRetiredLandlordAccountId(landlordId: string | null | undefined): boolean {
  const id = (landlordId ?? '').trim()
  return id === FULL_ALPHA_LANDLORD_ID || id === EMPTY_LANDLORD_ID
}

/** Landlord ids allowed to run setup + fast-track document extract. */
export const ONBOARDING_LANDLORD_IDS = [
  ...LIMITED_ALPHA_LANDLORD_IDS,
  ...LEASE_IMPORT_TEST_LANDLORD_IDS,
] as const

export function isOnboardingLandlordId(landlordId: string | null | undefined): boolean {
  const id = (landlordId ?? '').trim()
  return isSelfServiceLimitedAlphaLandlord(id) || (ONBOARDING_LANDLORD_IDS as readonly string[]).includes(id)
}

/** Reserved UUID namespace assigned only by verified self-service provisioning. */
export function isSelfServiceLimitedAlphaLandlord(landlordId: string | null | undefined): boolean {
  return /^a13a0000-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((landlordId ?? '').trim())
}

/** True Limited Alpha account ids only (not Demo). */
export function isLimitedAlphaLandlord(landlordId: string | null | undefined): boolean {
  const id = (landlordId ?? '').trim()
  return isSelfServiceLimitedAlphaLandlord(id) || (LIMITED_ALPHA_LANDLORD_IDS as readonly string[]).includes(id)
}

/** Disposable lease-import accounts. Not Limited Alpha 1 or 2. */
export function isLeaseImportTestLandlord(landlordId: string | null | undefined): boolean {
  const id = (landlordId ?? '').trim()
  return (LEASE_IMPORT_TEST_LANDLORD_IDS as readonly string[]).includes(id)
}

export function isDemoLandlord(landlordId: string | null | undefined): boolean {
  return (landlordId ?? '').trim() === DEMO_LANDLORD_ID
}

/**
 * Product surface shared by Limited Alpha and Demo: no payments / bank /
 * native-app channels, Twilio SMS line, Messages onboarding lanes, etc.
 * Data remains scoped to each landlord's own id.
 */
export function landlordUsesLimitedAlphaSurface(
  landlordId: string | null | undefined,
): boolean {
  const id = (landlordId ?? '').trim()
  return (
    isLimitedAlphaLandlord(id) ||
    isDemoLandlord(id) ||
    (LEASE_IMPORT_TEST_LANDLORD_IDS as readonly string[]).includes(id)
  )
}

/** Limited Alpha 1 only — not Alpha 2. Prefer `isLimitedAlphaLandlord` for shared alpha gates. */
export function isLimitedAlpha1Landlord(landlordId: string | null | undefined): boolean {
  return (landlordId ?? '').trim() === LIMITED_ALPHA_1_LANDLORD_ID
}

/** Limited Alpha 2 only. */
export function isLimitedAlpha2Landlord(landlordId: string | null | undefined): boolean {
  return (landlordId ?? '').trim() === LIMITED_ALPHA_2_LANDLORD_ID
}

/**
 * Temporary shared-line access for the disposable maintenance-test landlord.
 * The Alpha number stays owned by its existing account. Remove this id after
 * the maintenance phone tests.
 */
export const TEMPORARY_SHARED_ALPHA_LINE_LANDLORD_IDS = [
  'd15a0000-0000-4000-8000-000000000001',
] as const

export function isTemporarySharedAlphaLineLandlord(
  landlordId: string | null | undefined,
): boolean {
  const id = (landlordId ?? '').trim()
  return (TEMPORARY_SHARED_ALPHA_LINE_LANDLORD_IDS as readonly string[]).includes(id)
}

/**
 * This maintenance-test account must not search or text businesses outside
 * its roster. Other accounts keep Find External Vendor. Remove with the test.
 */
export function landlordBlocksExternalVendorOutreach(
  landlordId: string | null | undefined,
): boolean {
  return isTemporarySharedAlphaLineLandlord(landlordId)
}

/**
 * Accounts that may send and receive on the shared Limited Alpha Twilio number.
 * Does not change payments or the rest of the Limited Alpha product surface.
 */
export function landlordMayUseSharedAlphaLine(
  landlordId: string | null | undefined,
): boolean {
  return landlordUsesLimitedAlphaSurface(landlordId) || isTemporarySharedAlphaLineLandlord(landlordId)
}

/** Production Twilio DID used as Limited Alpha 1 and 2's shared landlord_main line. */
export const LIMITED_ALPHA_1_TWILIO_SMS_NUMBER = '+18775803356'

/** Retired platform DID — never use as SMS intake or a test-SMS destination. */
const RETIRED_PLATFORM_SMS_NUMBERS = ['+19734005760'] as const

function smsDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '')
}

function matchesAnyDid(phone: string | null | undefined, numbers: readonly string[]): boolean {
  const digits = smsDigits(phone)
  if (!digits) return false
  return numbers.map(smsDigits).some((n) => digits === n || digits === n.slice(-10))
}

/** True when this number is a retired platform intake DID. */
export function isRetiredSmsIntakeNumber(phone: string | null | undefined): boolean {
  return matchesAnyDid(phone, RETIRED_PLATFORM_SMS_NUMBERS)
}

/** True when a stored SMS line must not be shown or used as resident intake. */
export function isUnusableSmsIntakeLine(params: {
  phone?: string | null
  provider?: string | null
}): boolean {
  return isRetiredSmsIntakeNumber(params.phone)
}

/** Number residents should text. Never a retired platform DID. */
export function resolveSmsIntakeNumber(params: {
  landlordId?: string | null
  phone?: string | null
  provider?: string | null
}): string {
  if (landlordMayUseSharedAlphaLine(params.landlordId)) {
    return LIMITED_ALPHA_1_TWILIO_SMS_NUMBER
  }
  const phone = (params.phone ?? '').trim()
  if (phone && !isUnusableSmsIntakeLine({ phone })) {
    return phone
  }
  return LIMITED_ALPHA_1_TWILIO_SMS_NUMBER
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
  const platform = [
    LIMITED_ALPHA_1_TWILIO_SMS_NUMBER,
    ...RETIRED_PLATFORM_SMS_NUMBERS,
  ]
  return matchesAnyDid(phone, platform)
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

/** Limited Alpha (+ Demo surface) send and receive on the shared Twilio DID —
 *  conversations, identities, and rosters stay per-landlord. */
export function landlordUsesTwilioSms(landlordId: string | null | undefined): boolean {
  return landlordUsesLimitedAlphaSurface(landlordId)
}

/** Stripe, ACH, Plaid, rent/invoice checkout, vendor payouts, and “pay online” links.
 *  Limited Alpha / Demo still record rent by landlord SMS without moving money. */
export function landlordHasPayments(landlordId: string | null | undefined): boolean {
  return !landlordUsesLimitedAlphaSurface(landlordId)
}

/** Find External Vendor / Ulo-vetted marketplace dispatch. */
export function landlordHasVendorMarketplace(_landlordId: string | null | undefined): boolean {
  return true
}

/** Push / native-app notification channels. */
export function landlordHasNativeMobileApp(landlordId: string | null | undefined): boolean {
  return !landlordUsesLimitedAlphaSurface(landlordId)
}

/** Accounting, bank reconciliation, and related document discovery. */
export function landlordHasAccounting(landlordId: string | null | undefined): boolean {
  return !landlordUsesLimitedAlphaSurface(landlordId)
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
  // Stripe checkout / pay-online money movement — block on Limited Alpha.
  // Off-platform landlord-confirmed rent bookkeeping (rent.ledger_updated,
  // rent.receipt_*, rent.tenant_payment_report_*) must still record.
  if (t === 'rent.payment_received' || t === 'rent.payment_failed' || t === 'rent.payment_requested') {
    return true
  }
  if (t === 'rent.payment_plan_offered') return true
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
