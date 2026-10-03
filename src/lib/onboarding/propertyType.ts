/**
 * Onboarding + admin property type helpers.
 * SFH detection and inventory sentinel live in `@shared/properties/propertyType`
 * so edge/SMS can share the same rule.
 */
import {
  isSingleFamilyPropertyType,
  PROPERTY_TYPE_OPTIONS,
  resolveCanonicalPropertyType,
  SINGLE_FAMILY_PROPERTY_TYPE,
  SINGLE_FAMILY_UNIT_LABEL,
} from '@shared/properties/propertyType'

export {
  isSingleFamilyPropertyType,
  SINGLE_FAMILY_UNIT_LABEL,
} from '@shared/properties/propertyType'

/** Canonical property type values for onboarding + properties table. */
export const FAST_TRACK_DEFAULT_PROPERTY_TYPE = SINGLE_FAMILY_PROPERTY_TYPE

export const ONBOARDING_PROPERTY_TYPE_OPTIONS = PROPERTY_TYPE_OPTIONS

/** Map extracted or legacy property type strings to a review dropdown value. */
export function resolveOnboardingPropertyType(value: string | undefined | null): string {
  return resolveCanonicalPropertyType(value)
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
