/**
 * Vendor step form helpers — moved from AdminOnboardingDashboard (behavior unchanged).
 */
import type { Dispatch, SetStateAction } from 'react'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import { getOnboardingErrorMessage } from '@/lib/errorMessage'
import {
  fetchOnboardingVendors,
  requireOnboardingLandlord,
  type LandlordOnboardingState,
  type OnboardingStep,
  type OnboardingVendor,
  type VendorFormRow,
} from '@/lib/onboarding'
import { phoneForDbOrError } from '@/lib/phoneFormat'
import { supabase } from '@/lib/supabase'
import {
  dbCategoryToVendorTrade,
  vendorTradeToDbCategory,
} from '@/lib/vendorTrades'
import { isPersistedOnboardingRowId } from './onboardingPersistedId'

export type { VendorFormRow }

export function createEmptyVendorForm(): VendorFormRow {
  return {
    id: `vendor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    category: '',
    email: '',
    phone: '',
    preferredEmergency: false,
  }
}

export function vendorToFormRow(vendor: OnboardingVendor): VendorFormRow {
  return {
    id: vendor.id,
    name: vendor.name,
    category: dbCategoryToVendorTrade(vendor.category),
    email: vendor.email,
    phone: vendor.phone,
    preferredEmergency: Boolean(vendor.preferredEmergency),
  }
}

export function normalizeVendorFormRow(
  form: Partial<VendorFormRow> & { id: string },
): VendorFormRow {
  return {
    id: form.id,
    name: form.name ?? '',
    category: form.category ?? '',
    email: form.email ?? '',
    phone: form.phone ?? '',
    preferredEmergency: Boolean(form.preferredEmergency),
  }
}

export function dedupeVendorForms(
  forms: Array<Partial<VendorFormRow> & { id: string }>,
): VendorFormRow[] {
  const seenIds = new Set<string>()
  const byName = new Map<string, VendorFormRow>()
  const unnamed: VendorFormRow[] = []

  for (const raw of forms) {
    const form = normalizeVendorFormRow(raw)
    const id = form.id.trim()
    if (id && seenIds.has(id)) continue
    if (id) seenIds.add(id)

    const nameKey = form.name.trim().toLowerCase()
    if (!nameKey) {
      unnamed.push(form)
      continue
    }

    const existing = byName.get(nameKey)
    if (!existing) {
      byName.set(nameKey, form)
      continue
    }

    // Prefer the persisted database row when names collide.
    if (
      !isPersistedOnboardingRowId(existing.id) &&
      isPersistedOnboardingRowId(form.id)
    ) {
      byName.set(nameKey, form)
    }
  }

  const deduped = [...byName.values(), ...unnamed]
  return deduped.length > 0 ? deduped : [createEmptyVendorForm()]
}

export function applyVendorFormPatch(
  forms: VendorFormRow[],
  id: string,
  patch: Partial<VendorFormRow>,
): VendorFormRow[] {
  return forms.map((row) => (row.id === id ? { ...row, ...patch } : row))
}

/** Side-effect for removing a persisted vendor row (fire-and-forget). */
export function deletePersistedOnboardingVendor(
  id: string,
  deps: {
    setError: (value: string | null) => void
    refreshCounts: () => Promise<void>
  },
): void {
  if (!isPersistedOnboardingRowId(id) || !supabase) return
  void supabase
    .from('vendors')
    .delete()
    .eq('id', id)
    .eq('landlord_id', getActiveLandlordId())
    .then(({ error: deleteError }) => {
      if (deleteError) {
        deps.setError(
          getOnboardingErrorMessage(deleteError, 'Couldn’t remove that vendor. Please try again.'),
        )
        return
      }
      void deps.refreshCounts()
    })
}

export type SaveOnboardingVendorsStepInput = {
  vendorForms: VendorFormRow[]
  editingFromReview: boolean
  setSaving: (value: boolean) => void
  setError: (value: string | null) => void
  setVendorForms: Dispatch<SetStateAction<VendorFormRow[]>>
  returnToReviewAfterEdit: (patch?: Partial<LandlordOnboardingState>) => Promise<void>
  goTo: (
    nextStep: OnboardingStep,
    patch?: Partial<LandlordOnboardingState>,
    forms?: {
      vendorForms?: VendorFormRow[]
    },
  ) => Promise<void>
  refreshCounts: () => Promise<void>
}

export async function saveOnboardingVendorsStep(
  input: SaveOnboardingVendorsStepInput,
): Promise<void> {
  const {
    vendorForms,
    editingFromReview,
    setSaving,
    setError,
    setVendorForms,
    returnToReviewAfterEdit,
    goTo,
    refreshCounts,
  } = input

  if (!supabase) {
    setError("We can't reach the server right now. Please try again in a moment.")
    return
  }
  const scope = requireOnboardingLandlord()
  if (!scope.ok) {
    setError(scope.error)
    return
  }

  const vendorsToSave = vendorForms.filter((form) => form.name.trim())
  for (const form of vendorForms) {
    const hasPartialData =
      form.name.trim() ||
      form.category.trim() ||
      form.email.trim() ||
      form.phone.trim()
    if (hasPartialData && !form.name.trim()) {
      setError('Each vendor needs a name, or clear empty vendor rows.')
      return
    }
  }

  setSaving(true)
  setError(null)

  const existingVendors = await fetchOnboardingVendors()
  const existingByName = new Map(
    existingVendors.map((vendor) => [vendor.name.trim().toLowerCase(), vendor]),
  )

  const vendorPhones: Array<{ phone: string | null }> = []
  for (const form of vendorsToSave) {
    const phoneResult = phoneForDbOrError(form.phone)
    if (phoneResult.error) {
      setSaving(false)
      setError(`${form.name.trim()}: ${phoneResult.error}`)
      return
    }
    vendorPhones.push({ phone: phoneResult.phone })
  }

  for (let i = 0; i < vendorsToSave.length; i++) {
    const form = vendorsToSave[i]!
    const payload = {
      name: form.name.trim(),
      category: vendorTradeToDbCategory(form.category),
      email: form.email.trim() || null,
      phone: vendorPhones[i]!.phone,
      notification_channel: 'both' as const,
      active: true,
      preferred_emergency: form.preferredEmergency === true,
    }

    if (isPersistedOnboardingRowId(form.id)) {
      const { error: updateError } = await supabase
        .from('vendors')
        .update(payload)
        .eq('id', form.id)
        .eq('landlord_id', getActiveLandlordId())
      if (updateError) {
        setSaving(false)
        setError(getOnboardingErrorMessage(updateError, 'Couldn’t save this vendor. Please try again.'))
        return
      }
      continue
    }

    const existing = existingByName.get(form.name.trim().toLowerCase())
    if (existing) {
      const { error: updateError } = await supabase
        .from('vendors')
        .update(payload)
        .eq('id', existing.id)
        .eq('landlord_id', getActiveLandlordId())
      if (updateError) {
        setSaving(false)
        setError(getOnboardingErrorMessage(updateError, 'Couldn’t save this vendor. Please try again.'))
        return
      }
      continue
    }

    const { error: insertError } = await supabase.from('vendors').insert({
      ...payload,
      landlord_id: getActiveLandlordId(),
    })
    if (insertError) {
      // Leftover row with same name/constraints: update instead of failing the wizard.
      const leftover = existingByName.get(form.name.trim().toLowerCase())
      if (leftover) {
        const { error: updateError } = await supabase
          .from('vendors')
          .update(payload)
          .eq('id', leftover.id)
          .eq('landlord_id', getActiveLandlordId())
        if (updateError) {
          setSaving(false)
          setError(getOnboardingErrorMessage(updateError, 'Couldn’t save this vendor. Please try again.'))
          return
        }
        continue
      }
      // Re-fetch once in case the map was stale, then update by name.
      const refreshed = await fetchOnboardingVendors()
      const match = refreshed.find(
        (vendor) => vendor.name.trim().toLowerCase() === form.name.trim().toLowerCase(),
      )
      if (match) {
        const { error: updateError } = await supabase
          .from('vendors')
          .update(payload)
          .eq('id', match.id)
          .eq('landlord_id', getActiveLandlordId())
        if (updateError) {
          setSaving(false)
          setError(getOnboardingErrorMessage(updateError, 'Couldn’t save this vendor. Please try again.'))
          return
        }
        continue
      }
      setSaving(false)
      setError(getOnboardingErrorMessage(insertError, 'Couldn’t save this vendor. Please try again.'))
      return
    }
  }

  await refreshCounts()
  const savedVendors = await fetchOnboardingVendors()
  const savedVendorForms = dedupeVendorForms(
    savedVendors.length > 0 ? savedVendors.map(vendorToFormRow) : [createEmptyVendorForm()],
  )
  setVendorForms(savedVendorForms)
  setSaving(false)
  if (editingFromReview) {
    await returnToReviewAfterEdit()
    return
  }
  await goTo('residents', {}, { vendorForms: savedVendorForms })
}
