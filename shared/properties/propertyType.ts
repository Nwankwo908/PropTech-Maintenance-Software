/**
 * Shared property-type helpers for admin UI and edge/SMS.
 * Single-family dwellings must not surface unit numbers in user-facing copy.
 */

export const SINGLE_FAMILY_PROPERTY_TYPE = 'single_family_home'

/**
 * Internal inventory label for a single-family dwelling.
 * Not a unit number — formatters omit it in landlord/tenant/vendor-facing text.
 */
export const SINGLE_FAMILY_UNIT_LABEL = 'Home'

/** Canonical types used across onboarding + properties.property_type. */
export const PROPERTY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'single_family_home', label: 'Single-Family Home' },
  { value: 'multifamily', label: 'Multifamily / Apartment Building' },
  { value: 'condo', label: 'Condo' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'commercial', label: 'Commercial Property' },
]

/**
 * Map extracted / legacy / Add Property aliases to a canonical property type.
 * Empty/unknown defaults to single_family_home (same as onboarding Fast Track).
 */
export function resolveCanonicalPropertyType(value: string | undefined | null): string {
  const raw = (value ?? '').trim().toLowerCase()
  if (!raw) return SINGLE_FAMILY_PROPERTY_TYPE

  const exact = PROPERTY_TYPE_OPTIONS.find(
    (option) =>
      option.value === raw ||
      option.label.toLowerCase() === raw ||
      option.label.toLowerCase().replace(/\s+/g, '_') === raw,
  )
  if (exact) return exact.value

  if (
    raw.includes('single') ||
    raw === 'single_family' ||
    raw === 'sfr' ||
    raw === 'detached' ||
    raw === 'house'
  ) {
    return SINGLE_FAMILY_PROPERTY_TYPE
  }
  if (
    raw.includes('multi') ||
    raw.includes('apartment') ||
    raw.includes('duplex') ||
    raw.includes('triplex') ||
    raw.includes('two family') ||
    raw.includes('2 family') ||
    raw.includes('2-family') ||
    raw.includes('two-family')
  ) {
    return 'multifamily'
  }
  if (raw.includes('condo') || raw.includes('co-op') || raw.includes('coop')) return 'condo'
  if (raw.includes('town')) return 'townhouse'
  if (
    raw.includes('commercial') ||
    raw === 'mixed_use' ||
    raw.includes('retail') ||
    raw.includes('office')
  ) {
    return 'commercial'
  }

  return SINGLE_FAMILY_PROPERTY_TYPE
}

/** True for single-family homes (including Add Property's `single_family` alias). */
export function isSingleFamilyPropertyType(value: string | undefined | null): boolean {
  const raw = (value ?? '').trim()
  if (!raw) return false
  return resolveCanonicalPropertyType(raw) === SINGLE_FAMILY_PROPERTY_TYPE
}
