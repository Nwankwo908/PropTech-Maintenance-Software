/** Canonical property type values for onboarding + properties table. */
export const FAST_TRACK_DEFAULT_PROPERTY_TYPE = 'single_family_home'

export const ONBOARDING_PROPERTY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'single_family_home', label: 'Single-Family Home' },
  { value: 'multifamily', label: 'Multifamily / Apartment Building' },
  { value: 'condo', label: 'Condo' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'commercial', label: 'Commercial Property' },
]

/** Map extracted or legacy property type strings to a review dropdown value. */
export function resolveOnboardingPropertyType(value: string | undefined | null): string {
  const raw = (value ?? '').trim().toLowerCase()
  if (!raw) return FAST_TRACK_DEFAULT_PROPERTY_TYPE

  const exact = ONBOARDING_PROPERTY_TYPE_OPTIONS.find(
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
    return 'single_family_home'
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
  if (raw.includes('commercial') || raw === 'mixed_use' || raw.includes('retail') || raw.includes('office')) {
    return 'commercial'
  }

  return FAST_TRACK_DEFAULT_PROPERTY_TYPE
}

export function onboardingPropertyTypeLabel(value: string | undefined | null): string {
  const resolved = resolveOnboardingPropertyType(value)
  return (
    ONBOARDING_PROPERTY_TYPE_OPTIONS.find((option) => option.value === resolved)?.label ??
    resolved
  )
}

/** Infer type when only unit inventory is known (rent-roll building rows). */
export function inferOnboardingPropertyTypeFromUnitCount(unitCount: number): string {
  return unitCount >= 2 ? 'multifamily' : FAST_TRACK_DEFAULT_PROPERTY_TYPE
}
