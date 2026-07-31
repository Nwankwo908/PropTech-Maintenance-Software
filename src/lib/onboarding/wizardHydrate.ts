/**
 * Hydrate wizard form rows from persisted onboarding state.
 */
import {
  normalizePropertyFormRow,
  propertyFormsFromState,
} from '@/components/onboarding/onboardingPropertyForm'
import type { LandlordOnboardingState, PropertyFormRow } from './types'

export function hydratePropertyFormsFromOnboarding(
  onboarding: LandlordOnboardingState,
): PropertyFormRow[] | null {
  const draft = onboarding.formDraft
  if (draft?.propertyForms?.length) {
    return draft.propertyForms.map(normalizePropertyFormRow)
  }
  if (onboarding.properties.length > 0) {
    return propertyFormsFromState(onboarding.properties)
  }
  return null
}
