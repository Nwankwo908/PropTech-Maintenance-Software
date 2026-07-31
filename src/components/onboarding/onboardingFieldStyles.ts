/**
 * Shared field styles for guided onboarding steps.
 */

export const onboardingInputClass =
  'h-10 w-full rounded-[8px] border border-[#e5e7eb] bg-white px-3 text-[14px] text-[#101828] outline-none placeholder:text-[#9ca3af] focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

export const onboardingFieldLabelClass = 'mb-1 block text-[13px] font-medium text-[#364153]'

export const onboardingSelectClass =
  'h-10 w-full cursor-pointer appearance-none rounded-[8px] border border-[#e5e7eb] bg-white py-2 pl-3 pr-10 text-[14px] text-[#101828] outline-none focus:border-[#155dfc] focus:ring-2 focus:ring-[#155dfc]/20'

export const ONBOARDING_PROPERTY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'multifamily', label: 'Multifamily' },
  { value: 'single_family', label: 'Single Family' },
  { value: 'mixed_use', label: 'Mixed Use' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'student_housing', label: 'Student Housing' },
]
