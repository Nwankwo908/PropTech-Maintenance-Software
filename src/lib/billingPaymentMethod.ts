import { getActiveLandlordId } from '@/lib/activeLandlord'
import type {
  BillingPaymentMethod,
  LandlordAccountSettingsPayload,
  LandlordBillingSettings,
} from '@/lib/landlordSettings/types'
import { supabase } from '@/lib/supabase'

export function detectCardBrand(digits: string): string {
  if (/^4/.test(digits)) return 'Visa'
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'Mastercard'
  if (/^3[47]/.test(digits)) return 'Amex'
  if (/^6/.test(digits)) return 'Discover'
  return 'Card'
}

export function parseExpiration(value: string): { month: string; year: string } | null {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 4) return null
  const month = digits.slice(0, 2)
  const year = digits.slice(2, 4)
  const monthNum = Number(month)
  if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) return null
  return { month, year }
}

export function normalizeBillingPaymentMethod(
  raw: Partial<BillingPaymentMethod> | null | undefined,
): BillingPaymentMethod | null {
  if (!raw || typeof raw !== 'object') return null
  const last4 = typeof raw.last4 === 'string' ? raw.last4.replace(/\D/g, '').slice(-4) : ''
  const expMonth = typeof raw.expMonth === 'string' ? raw.expMonth.replace(/\D/g, '').padStart(2, '0').slice(-2) : ''
  const expYearRaw = typeof raw.expYear === 'string' ? raw.expYear.replace(/\D/g, '') : ''
  const expYear =
    expYearRaw.length === 2 ? `20${expYearRaw}` : expYearRaw.length === 4 ? expYearRaw : ''
  const brand = typeof raw.brand === 'string' ? raw.brand.trim() : ''
  if (last4.length !== 4 || !expMonth || !expYear) return null
  return {
    brand: brand || 'Card',
    last4,
    expMonth,
    expYear,
  }
}

export function normalizeLandlordBillingSettings(
  raw: Partial<LandlordBillingSettings> | null | undefined,
): LandlordBillingSettings {
  return {
    paymentMethod: normalizeBillingPaymentMethod(raw?.paymentMethod ?? null),
  }
}

export function formatPaymentMethodLabel(method: BillingPaymentMethod): string {
  return `${method.brand} ···· ${method.last4}`
}

export function formatPaymentMethodExpiry(method: BillingPaymentMethod): string {
  return `Expires ${method.expMonth}/${method.expYear.slice(-2)}`
}

export function paymentMethodFromCardInput(input: {
  cardNumber: string
  expiration: string
}): { ok: true; method: BillingPaymentMethod } | { ok: false; error: string } {
  const digits = input.cardNumber.replace(/\D/g, '')
  if (digits.length < 12) {
    return { ok: false, error: 'Enter a valid card number.' }
  }
  const parsedExp = parseExpiration(input.expiration)
  if (!parsedExp) {
    return { ok: false, error: 'Enter a valid expiration date (MM / YY).' }
  }
  return {
    ok: true,
    method: {
      brand: detectCardBrand(digits),
      last4: digits.slice(-4),
      expMonth: parsedExp.month,
      expYear: `20${parsedExp.year}`,
    },
  }
}

export async function loadBillingPaymentMethod(
  landlordId: string = getActiveLandlordId(),
): Promise<BillingPaymentMethod | null> {
  if (!supabase) return null
  const { data } = await supabase
    .from('landlord_onboarding')
    .select('account_settings')
    .eq('landlord_id', landlordId)
    .maybeSingle()
  const account = (data?.account_settings ?? {}) as LandlordAccountSettingsPayload
  return normalizeLandlordBillingSettings(account.billing).paymentMethod
}

export async function saveBillingPaymentMethod(
  method: BillingPaymentMethod | null,
  landlordId: string = getActiveLandlordId(),
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: 'Database unavailable.' }

  const normalized = normalizeBillingPaymentMethod(method)

  const { data: existing } = await supabase
    .from('landlord_onboarding')
    .select('account_settings, draft_state')
    .eq('landlord_id', landlordId)
    .maybeSingle()

  const prior = (existing?.account_settings ?? {}) as LandlordAccountSettingsPayload
  const accountSettings: LandlordAccountSettingsPayload = {
    ...prior,
    version: 1,
    billing: {
      paymentMethod: normalized,
    },
  }

  const { error } = await supabase.from('landlord_onboarding').upsert(
    {
      landlord_id: landlordId,
      account_settings: accountSettings,
      draft_state: existing?.draft_state ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'landlord_id' },
  )

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
