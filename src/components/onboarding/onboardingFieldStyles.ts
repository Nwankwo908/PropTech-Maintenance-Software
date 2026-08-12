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

export {
  FAST_TRACK_DEFAULT_PROPERTY_TYPE,
  ONBOARDING_PROPERTY_TYPE_OPTIONS,
  inferOnboardingPropertyTypeFromUnitCount,
  onboardingPropertyTypeLabel,
  resolveOnboardingPropertyType,
} from '@/lib/onboarding/propertyType'
