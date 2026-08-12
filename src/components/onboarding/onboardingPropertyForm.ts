/**
 * Property step form helpers — moved from AdminOnboardingDashboard (behavior unchanged).
 */
import {
  createPropertyId,
  persistOnboardingProperties,
  type LandlordOnboardingState,
  type OnboardingProperty,
  type OnboardingStep,
  type PropertyFormRow,
} from '@/lib/onboarding'
import { ensureProperty } from '@/lib/properties'
import { isPropertyIdSlug } from '@/lib/propertyRoutes'
import { citiesForState } from '@/lib/usLocations'

export type { PropertyFormRow }

export function createEmptyPropertyForm(): PropertyFormRow {
  return {
    id: createPropertyId(),
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    propertyType: 'multifamily',
    unitCount: '',
    propertyManagerName: '',
    propertyManagerPhone: '',
  }
}

export function normalizePropertyFormRow(
  form: Partial<PropertyFormRow> & { id: string },
): PropertyFormRow {
  const state = (form.state ?? '').trim().toUpperCase()
  const city = (form.city ?? '').trim()
  return {
    id: form.id,
    name: form.name ?? '',
    address: form.address ?? '',
    city,
    state,
    zipCode: form.zipCode ?? '',
    propertyType: form.propertyType ?? 'multifamily',
    unitCount: form.unitCount ?? '',
    propertyManagerName: form.propertyManagerName ?? '',
    propertyManagerPhone: form.propertyManagerPhone ?? '',
  }
}

export function cityOptionsForProperty(form: PropertyFormRow): string[] {
  const cities = [...citiesForState(form.state)]
  const current = form.city.trim()
  if (current && !cities.includes(current)) {
    cities.unshift(current)
  }
  return cities
}

export function formatPropertyAddress(property: OnboardingProperty): string {
  return [property.streetAddress, property.city, property.state, property.zipCode]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
}

export function propertyFormToOnboarding(form: PropertyFormRow): OnboardingProperty | null {
  const unitCount = Number.parseInt(form.unitCount, 10)
  const name = form.name.trim()
  const streetAddress = form.address.trim()
  const city = form.city.trim()
  const state = form.state.trim().toUpperCase()
  const zipCode = form.zipCode.trim()
  if (
    !name ||
    !streetAddress ||
    !city ||
    !state ||
    !zipCode ||
    !Number.isFinite(unitCount) ||
    unitCount < 1
  ) {
    return null
  }
  return {
    id: form.id,
    name,
    streetAddress,
    city,
    state,
    zipCode,
    unitCount,
    propertyType: (form.propertyType || 'multifamily').trim() || 'multifamily',
    propertyManagerName: form.propertyManagerName.trim(),
    propertyManagerPhone: form.propertyManagerPhone.trim(),
  }
}

export function propertyFormsFromState(properties: OnboardingProperty[]): PropertyFormRow[] {
  return properties.map((property) => ({
    id: property.id,
    name: property.name,
    address: property.streetAddress || formatPropertyAddress(property),
    city: property.city ?? '',
    state: property.state ?? '',
    zipCode: property.zipCode ?? '',
    propertyType: property.propertyType?.trim() || 'multifamily',
    unitCount: String(property.unitCount),
    propertyManagerName: property.propertyManagerName ?? '',
    propertyManagerPhone: property.propertyManagerPhone ?? '',
  }))
}

export function applyPropertyFormPatch(
  forms: PropertyFormRow[],
  id: string,
  patch: Partial<PropertyFormRow>,
): PropertyFormRow[] {
  return forms.map((row) => {
    if (row.id !== id) return row
    const next = { ...row, ...patch }
    if (patch.state !== undefined) {
      const state = patch.state.trim().toUpperCase()
      next.state = state
      const allowed = citiesForState(state)
      if (next.city && !allowed.includes(next.city)) {
        next.city = ''
      }
    }
    return next
  })
}

function isDraftOnboardingPropertyId(id: string): boolean {
  return id.startsWith('draft-') || id.startsWith('ext-prop-')
}

/**
 * Mint or retrieve the canonical properties.id as soon as the landlord names a property.
 * Best-effort — wizard continues with the draft id if the server call fails.
 */
export async function mintOnboardingPropertyIdIfNeeded(
  form: PropertyFormRow,
): Promise<string | null> {
  const name = form.name.trim()
  if (!name) return null
  if (isPropertyIdSlug(form.id) && !isDraftOnboardingPropertyId(form.id)) {
    return form.id
  }

  const unitCount = Number.parseInt(form.unitCount, 10)
  const ensured = await ensureProperty({
    name,
    streetAddress: form.address.trim() || null,
    city: form.city.trim() || null,
    state: form.state.trim().toUpperCase() || null,
    zipCode: form.zipCode.trim() || null,
    propertyType: form.propertyType?.trim() || null,
    managerName: form.propertyManagerName.trim() || null,
    managerPhone: form.propertyManagerPhone.trim() || null,
    unitCount: Number.isFinite(unitCount) && unitCount >= 1 ? unitCount : null,
  })
  if (!ensured.ok) return null
  return ensured.propertyId
}

export type SaveOnboardingPropertyStepInput = {
  propertyForms: PropertyFormRow[]
  editingFromReview: boolean
  setSaving: (value: boolean) => void
  setError: (value: string | null) => void
  returnToReviewAfterEdit: (patch?: Partial<LandlordOnboardingState>) => Promise<void>
  goTo: (
    nextStep: OnboardingStep,
    patch?: Partial<LandlordOnboardingState>,
  ) => Promise<void>
  refreshCounts: () => Promise<void>
}

export async function saveOnboardingPropertyStep(
  input: SaveOnboardingPropertyStepInput,
): Promise<void> {
  const {
    propertyForms,
    editingFromReview,
    setSaving,
    setError,
    returnToReviewAfterEdit,
    goTo,
    refreshCounts,
  } = input

  const properties = propertyForms
    .map(propertyFormToOnboarding)
    .filter((property): property is OnboardingProperty => property != null)

  if (properties.length !== propertyForms.length) {
    setError(
      'Each property needs a name, street address, city, state, ZIP code, and at least one unit.',
    )
    return
  }

  setSaving(true)
  setError(null)
  const result = await persistOnboardingProperties(properties)
  if (!result.ok) {
    setSaving(false)
    setError(result.error ?? 'Could not register units.')
    return
  }

  const savedProperties = result.properties

  if (editingFromReview) {
    await returnToReviewAfterEdit({ properties: savedProperties })
    setSaving(false)
    return
  }

  await goTo('vendors', { properties: savedProperties })
  await refreshCounts()
  setSaving(false)
}
