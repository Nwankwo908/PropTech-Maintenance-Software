/**
 * Client mirror of `supabase/functions/_shared/vendor_verification/w9TaxProfile.ts`.
 * Keep the two in sync.
 */

export type TaxEntityType =
  | 'sole_proprietor'
  | 'llc'
  | 'corporation'
  | 'partnership'
  | 'other'

export type TinType = 'ssn' | 'ein'
export type W9Variant = 'individual' | 'business'
export type Tax1099Treatment = 'nec' | 'none'

export type W9TaxProfile = {
  taxEntityType: TaxEntityType
  tinType: TinType
  w9Variant: W9Variant
  tax1099Treatment: Tax1099Treatment
}

export const TAX_ENTITY_OPTIONS: Array<{
  value: TaxEntityType
  label: string
}> = [
  { value: 'sole_proprietor', label: 'Sole proprietor' },
  { value: 'llc', label: 'LLC' },
  { value: 'corporation', label: 'Corporation' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'other', label: 'Other' },
]

export function isTaxEntityType(value: unknown): value is TaxEntityType {
  return (
    value === 'sole_proprietor' ||
    value === 'llc' ||
    value === 'corporation' ||
    value === 'partnership' ||
    value === 'other'
  )
}

export function taxProfileForEntity(entity: TaxEntityType): W9TaxProfile {
  if (entity === 'sole_proprietor') {
    return {
      taxEntityType: entity,
      tinType: 'ssn',
      w9Variant: 'individual',
      tax1099Treatment: 'nec',
    }
  }
  if (entity === 'corporation') {
    return {
      taxEntityType: entity,
      tinType: 'ein',
      w9Variant: 'business',
      tax1099Treatment: 'none',
    }
  }
  return {
    taxEntityType: entity,
    tinType: 'ein',
    w9Variant: 'business',
    tax1099Treatment: 'nec',
  }
}

export function normalizeTinDigits(raw: string): string {
  return raw.replace(/\D/g, '')
}

export function validateTinDigits(
  digits: string,
  tinType: TinType,
): { ok: true } | { ok: false; error: string } {
  if (digits.length !== 9) {
    return {
      ok: false,
      error:
        tinType === 'ssn'
          ? 'Enter a 9-digit Social Security number.'
          : 'Enter a 9-digit Employer Identification Number (EIN).',
    }
  }
  if (/^0+$/.test(digits)) {
    return { ok: false, error: 'Enter a valid tax ID.' }
  }
  return { ok: true }
}

export function maskTin(tinType: TinType, last4: string | null | undefined): string {
  const tail = (last4 ?? '').trim()
  if (!/^\d{4}$/.test(tail)) return tinType === 'ssn' ? '•••-••-••••' : '••-•••••••'
  return tinType === 'ssn' ? `•••-••-${tail}` : `••-•••${tail}`
}

export function taxProfileComplete(record: {
  taxEntityType?: string | null
  tinType?: string | null
  tinLast4?: string | null
  w9Received?: boolean | null
}): boolean {
  if (record.w9Received !== true) return false
  if (!isTaxEntityType(record.taxEntityType)) return false
  const expected = taxProfileForEntity(record.taxEntityType)
  if (record.tinType !== expected.tinType) return false
  if (!/^\d{4}$/.test((record.tinLast4 ?? '').trim())) return false
  return true
}

export function tinFieldLabel(tinType: TinType): string {
  return tinType === 'ssn' ? 'Social Security number (SSN)' : 'Employer Identification Number (EIN)'
}

export function tinFieldHint(tinType: TinType): string {
  return tinType === 'ssn'
    ? 'Sole proprietors use SSN on the individual W-9.'
    : 'LLCs and corporations use EIN on the business W-9.'
}
