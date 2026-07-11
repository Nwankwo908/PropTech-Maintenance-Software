/** Strip to digits for `tel:` links (US numbers need at least 10 digits). */
export function phoneDigitsForTelLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits
}

export function telHref(phone: string | null | undefined): string | null {
  const digits = phoneDigitsForTelLink(phone)
  return digits ? `tel:${digits}` : null
}

/** Opens the device dialer. Returns false when the number is missing or invalid. */
export function openPhoneDialer(phone: string | null | undefined): boolean {
  const href = telHref(phone)
  if (!href) return false
  window.location.href = href
  return true
}
