import { LIMITED_ALPHA_1_LOGIN_EMAIL } from '@/lib/activeLandlord'

/** Login mailboxes that must not populate Support email. */
export const PLATFORM_LOGIN_EMAILS = new Set([
  LIMITED_ALPHA_1_LOGIN_EMAIL.toLowerCase(),
  'demo@ulohome.io',
  'newlandlord@ulohome.io',
])

export function isPlatformLoginEmail(value: string | null | undefined): boolean {
  const email = (value ?? '').trim().toLowerCase()
  return Boolean(email) && PLATFORM_LOGIN_EMAILS.has(email)
}

function asEmail(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Canonical support / organization contact email.
 * Never prefer the Alpha/demo login mailbox over an address the landlord entered.
 */
export function resolveLandlordSupportEmail(input: {
  accountSetupEmail?: string | null
  organizationSupportEmail?: string | null
  landlordEmail?: string | null
}): string {
  const ordered = [
    asEmail(input.accountSetupEmail),
    asEmail(input.organizationSupportEmail),
    asEmail(input.landlordEmail),
  ].filter(Boolean)
  const operational = ordered.filter((email) => !isPlatformLoginEmail(email))
  return operational[0] ?? ''
}
