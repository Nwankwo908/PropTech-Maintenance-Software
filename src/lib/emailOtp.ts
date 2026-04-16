/**
 * Supabase `{{ .Token }}` is often 6 digits, but hosted Auth versions may use
 * longer numeric or short alphanumeric OTPs. Keep validation loose — the Auth
 * API is the source of truth.
 */
export const EMAIL_OTP_MAX_LEN = 12

/** Strip spaces/dashes; keep digits and letters only. */
export function normalizeEmailOtpInput(raw: string): string {
  return raw
    .replace(/\s/g, '')
    .replace(/[^0-9A-Za-z]/g, '')
    .slice(0, EMAIL_OTP_MAX_LEN)
}

export function isValidEmailOtpToken(token: string): boolean {
  const t = token.trim()
  if (t.length < 6 || t.length > EMAIL_OTP_MAX_LEN) return false
  if (!/^[0-9A-Za-z]+$/.test(t)) return false
  // Hosted GoTrue often uses 6–10 digit OTPs; some projects use short alphanumeric codes.
  if (/^\d+$/.test(t)) return t.length <= 10
  return true
}

/** Lengths at which we auto-submit after typing (common Supabase / GoTrue shapes). */
export function shouldAutoSubmitEmailOtp(token: string): boolean {
  const t = token.trim()
  if (/^\d{6}$/.test(t) || /^\d{8}$/.test(t) || /^\d{10}$/.test(t)) return true
  if (/^[A-Za-z0-9]{10}$/.test(t)) return true
  return false
}
