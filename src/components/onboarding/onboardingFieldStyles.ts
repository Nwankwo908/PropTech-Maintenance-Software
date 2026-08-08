/**
 * Shared field styles for guided onboarding steps.
 */

export const onboardingInputClass =
  'h-10 w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[14px] text-[#101828] outline-none placeholder:text-[#9ca3af] focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

export const onboardingFieldLabelClass = 'mb-1 block text-[13px] font-medium text-[#364153]'

export const onboardingSelectClass =
  'h-10 w-full cursor-pointer appearance-none rounded-[8px] border border-[#e5e7eb] bg-white py-2 pl-3 pr-10 text-[14px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

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
  if (!raw) return ''

  const exact = ONBOARDING_PROPERTY_TYPE_OPTIONS.find(
    (option) =>
      option.value === raw ||
      option.label.toLowerCase() === raw ||
      option.label.toLowerCase().replace(/\s+/g, '_') === raw,
  )
  if (exact) return exact.value

  if (raw.includes('single') || raw === 'single_family' || raw === 'sfr') {
    return 'single_family_home'
  }
  if (raw.includes('multi') || raw.includes('apartment')) return 'multifamily'
  if (raw.includes('condo')) return 'condo'
  if (raw.includes('town')) return 'townhouse'
  if (raw.includes('commercial') || raw === 'mixed_use') return 'commercial'

  return ''
}

export function onboardingPropertyTypeLabel(value: string | undefined | null): string {
  const resolved = resolveOnboardingPropertyType(value)
  if (resolved) {
    return ONBOARDING_PROPERTY_TYPE_OPTIONS.find((option) => option.value === resolved)?.label ?? resolved
  }
  const trimmed = (value ?? '').trim()
  return trimmed || 'Property type not set'
}
