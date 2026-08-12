/**
 * Shared field styles for guided onboarding steps.
 */

export const onboardingInputClass =
  'h-10 w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[14px] text-[#101828] outline-none placeholder:text-[#9ca3af] focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

export const onboardingFieldLabelClass = 'mb-1 block text-[13px] font-medium text-[#364153]'

export const onboardingSelectClass =
  'h-10 w-full cursor-pointer appearance-none rounded-[8px] border border-[#e5e7eb] bg-white py-2 pl-3 pr-10 text-[14px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

/** Shared Smart Animate surface + stagger target for onboarding cards. */
export const onboardingSurfaceSectionClass =
  'sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]'

export const onboardingNestedCardClass =
  'onb-form-card sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-4'

export const onboardingSectionStackClass = 'onb-section-stack space-y-3'

export const onboardingBtnPrimaryClass =
  'sa-press inline-flex cursor-pointer items-center justify-center rounded-[10px] bg-[#187960] px-6 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#146b52] disabled:cursor-not-allowed disabled:opacity-50'

export const onboardingBtnSecondaryClass =
  'sa-press inline-flex cursor-pointer items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-6 py-2.5 text-[14px] font-medium text-[#101828] transition-colors hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-50'

export const onboardingBtnGhostClass =
  'sa-press inline-flex cursor-pointer items-center justify-center rounded-[10px] px-4 py-2.5 text-[14px] font-medium text-[#6a7282] transition-colors hover:bg-[#f3f4f6] hover:text-[#101828] disabled:cursor-not-allowed disabled:opacity-50'

export const onboardingNavBtnClass =
  'sa-press inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[14px] font-medium tracking-[-0.1504px] text-[#364153] outline-none transition-[color,background-color,transform] duration-150 hover:bg-[#f3f4f6] hover:text-[#101828] active:bg-[#e5e7eb] focus-visible:ring-2 focus-visible:ring-[#101828]/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[#364153]'

/** Default when fast-track document extraction omits or cannot classify property type. */
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

  if (raw.includes('single') || raw === 'single_family' || raw === 'sfr') {
    return 'single_family_home'
  }
  if (raw.includes('multi') || raw.includes('apartment')) return 'multifamily'
  if (raw.includes('condo')) return 'condo'
  if (raw.includes('town')) return 'townhouse'
  if (raw.includes('commercial') || raw === 'mixed_use') return 'commercial'

  return FAST_TRACK_DEFAULT_PROPERTY_TYPE
}

export function onboardingPropertyTypeLabel(value: string | undefined | null): string {
  const resolved = resolveOnboardingPropertyType(value)
  if (resolved) {
    return ONBOARDING_PROPERTY_TYPE_OPTIONS.find((option) => option.value === resolved)?.label ?? resolved
  }
  const trimmed = (value ?? '').trim()
  return trimmed || 'Property type not set'
}
