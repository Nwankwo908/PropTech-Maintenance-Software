/**
 * Normalize user-entered phone numbers to E.164 for Postgres `phone_format_check`.
 * Matches edge-function logic in `supabase/functions/_shared/resident_notify.ts`.
 *
 * Accepts common US entry styles, e.g.:
 *   (555) 123-4567 · 555-123-4567 · 555.123.4567 · 555 123 4567
 *   5551234567 · +1 555 123 4567 · 1-555-123-4567 · +15551234567
 * Extensions such as "x123" or "ext 99" are stripped before normalization.
 */
export function normalizePhoneForDb(input: string | null | undefined): string | null {
  if (input == null) return null
  let trimmed = String(input).trim()
  if (!trimmed) return null

  trimmed = trimmed.replace(/\s*(?:ext(?:ension)?|x|#)\.?\s*\d+\s*$/i, '')

  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  if (digits.startsWith('011') && digits.length >= 13) {
    digits = digits.slice(3)
  }
  if (digits.startsWith('00') && digits.length > 11) {
    digits = digits.slice(2)
  }

  if (digits.length === 10) {
    digits = `1${digits}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  }
  if (digits.length > 11) {
    return `+${digits}`
  }
  return null
}

const PHONE_INPUT_ERROR =
  'Enter a valid phone number like (555) 123-4567, 555-123-4567, or +1 555 123 4567.'

export function phoneForDbOrError(input: string): { phone: string | null; error?: string } {
  const trimmed = input.trim()
  if (!trimmed) return { phone: null }
  const phone = normalizePhoneForDb(trimmed)
  if (!phone) {
    return { phone: null, error: PHONE_INPUT_ERROR }
  }
  return { phone }
}

/** Optional phone field — empty input is allowed; non-empty must normalize. */
export function optionalPhoneForDbOrError(
  input: string,
): { phone: string | null; error?: string } {
  return phoneForDbOrError(input)
}

/** Display E.164 as US national format, e.g. +19734005760 → (973) 400-5760 */
export function formatPhoneNational(input: string): string {
  const digits = input.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return input.trim()
}
