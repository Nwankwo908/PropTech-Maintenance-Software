/** Drop empty and system placeholder company names so extraction / settings can stay blank. */
const PLACEHOLDER_COMPANY_NAMES = new Set([
  'new landlord',
  'limited alpha 1',
  'limited alpha 2',
  'demo property management',
  'ulo operations',
  'your portfolio',
  'your company',
  'ulo',
  'ulo home',
  'ulo home, inc',
  'ulo home inc',
  'kendo',
  'kendo homes',
  'kendo properties',
  'kendo properties llc',
])

export function usableOnboardingCompanyName(raw: string | null | undefined): string {
  const name = (raw ?? '').trim()
  if (!name) return ''
  if (PLACEHOLDER_COMPANY_NAMES.has(name.toLowerCase())) return ''
  return name
}

/** Public label when the landlord did not enter a company: "{name} properties". */
export function contactPropertiesLabel(contactName: string | null | undefined): string {
  const name = (contactName ?? '').trim()
  if (!name) return ''
  if (/\bproperties$/i.test(name)) return name
  return `${name} properties`
}

export function isContactPropertiesLabel(
  label: string | null | undefined,
  contactName: string | null | undefined,
): boolean {
  const derived = contactPropertiesLabel(contactName)
  const value = (label ?? '').trim()
  return Boolean(derived) && value.toLowerCase() === derived.toLowerCase()
}

/** Company name for forms — not the derived "{name} properties" public label. */
export function storedLandlordCompanyName(
  name: string | null | undefined,
  contactName: string | null | undefined,
): string {
  const usable = usableOnboardingCompanyName(name)
  if (!usable) return ''
  if (isContactPropertiesLabel(usable, contactName)) return ''
  return usable
}

/** Name used in onboarding copy, SMS, and email when referring to the landlord. */
export function landlordPortfolioLabel(input: {
  companyName?: string | null
  contactName?: string | null
}): string {
  return (
    usableOnboardingCompanyName(input.companyName) || contactPropertiesLabel(input.contactName)
  )
}
