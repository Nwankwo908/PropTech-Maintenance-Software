/**
 * Fast-track AI review → portfolio import (document upload path).
 */
import {
  normalizeExtractionReview,
  summarizeReviewSelections,
  toMockExtractionReview,
  type OnboardingExtractionReview,
} from '@/lib/onboardingDocumentUpload'
import {
  accountSetupFromReviewManual,
  validateReviewManualAccount,
} from '@/lib/onboardingReviewManual'
import { resolveOnboardingPropertyType } from '@/lib/onboarding/propertyType'
import { supabase } from '@/lib/supabase'
import { importMockExtraction } from './importPortfolio'
import { persistLandlordAccountProfile } from './persist/account'
import { persistOnboardingProperties, collectExtractedUnitLabels } from './persist/properties'
import { requireOnboardingLandlord } from './scope'
import type { LandlordOnboardingState, OnboardingProperty, OnboardingStep } from './types'

export type CommitFastTrackImportInput = {
  review: OnboardingExtractionReview
  accountSetup: LandlordOnboardingState['accountSetup']
  onError: (message: string) => void
  onExtractionReview: (review: OnboardingExtractionReview) => void
  onSaving: (saving: boolean) => void
  refreshCounts: () => Promise<void>
  goTo: (
    nextStep: OnboardingStep,
    patch?: Partial<LandlordOnboardingState>,
    forms?: { extractionReview?: OnboardingExtractionReview | null },
  ) => Promise<void>
}

export async function commitFastTrackImport(
  input: CommitFastTrackImportInput,
): Promise<boolean> {
  const scope = requireOnboardingLandlord()
  if (!scope.ok) {
    input.onError(scope.error)
    return false
  }

  const normalized = normalizeExtractionReview(input.review, input.accountSetup)
  const accountCheck = validateReviewManualAccount(normalized.account)
  if (!accountCheck.ok) {
    input.onError(accountCheck.error)
    return false
  }

  input.onExtractionReview(normalized)
  input.onSaving(true)

  const selectionLog = summarizeReviewSelections(normalized)
  console.info('[onboarding] AI review continue selections', selectionLog)
  if (supabase) {
    try {
      const { recordActivityLog } = await import('@/lib/recordActivityLog')
      await recordActivityLog({
        landlordId: scope.landlordId,
        eventType: 'onboarding.extraction_review_continued',
        source: 'onboarding',
        actorType: 'landlord',
        metadata: {
          message: `Imported ${selectionLog.selected.total} item${
            selectionLog.selected.total === 1 ? '' : 's'
          }; skipped ${selectionLog.skipped.total}.`,
          step: 'ai_review',
          selected: selectionLog.selected,
          skipped: selectionLog.skipped,
          selected_ids: selectionLog.selectedIds,
          skipped_ids: selectionLog.skippedIds,
        },
      })
    } catch (err) {
      console.warn('[onboarding] selection log failed', err)
    }
  }

  const accountSetup = accountSetupFromReviewManual(normalized.account)
  const profile = await persistLandlordAccountProfile(scope.landlordId, accountSetup)
  if (!profile.ok) {
    input.onSaving(false)
    input.onError(profile.error ?? 'Could not save account details.')
    return false
  }

  const hasImport =
    normalized.properties.some((item) => item.selected) ||
    normalized.units.some((item) => item.selected) ||
    normalized.residents.some((item) => item.selected) ||
    normalized.vendors.some((item) => item.selected) ||
    normalized.leases.some((item) => item.selected) ||
    normalized.maintenanceIssues.some((item) => item.selected)

  let properties: OnboardingProperty[] = []

  if (hasImport) {
    const result = await importMockExtraction(toMockExtractionReview(normalized))
    if (!result.ok) {
      input.onSaving(false)
      input.onError(result.error ?? "We couldn't finish the import. Please try again.")
      return false
    }

    const selectedResidentCount = normalized.residents.filter((row) => row.selected).length
    if (selectedResidentCount > 0 && result.imported.residents < selectedResidentCount) {
      console.warn(
        '[onboarding] fast-track resident import partial',
        result.imported.residents,
        'of',
        selectedResidentCount,
      )
    }

    properties = normalized.properties
      .filter((property) => property.selected)
      .map((property) => {
        const selectedPropertyNames = normalized.properties
          .filter((row) => row.selected)
          .map((row) => row.name)
        const unitLabels = collectExtractedUnitLabels({
          propertyName: property.name,
          otherPropertyNames: selectedPropertyNames,
          units: normalized.units,
          residents: normalized.residents,
          leases: normalized.leases,
        })
        return {
          id: property.id,
          name: property.name,
          streetAddress: property.address.split(',')[0]?.trim() ?? property.address,
          city: property.city.trim(),
          state: property.state.trim().toUpperCase(),
          zipCode: property.zipCode.trim(),
          unitCount: Math.max(property.unitCount || 0, unitLabels.length, 1),
          unitLabels: unitLabels.length > 0 ? unitLabels : undefined,
          propertyType: resolveOnboardingPropertyType(property.propertyType),
          propertyManagerName: property.propertyManagerName.trim(),
          propertyManagerPhone: property.propertyManagerPhone.trim(),
        }
      })

    if (properties.length > 0) {
      const unitResult = await persistOnboardingProperties(properties)
      if (!unitResult.ok) {
        input.onSaving(false)
        input.onError(unitResult.error ?? 'Could not save property locations.')
        return false
      }
      properties = unitResult.properties
    }

    await input.refreshCounts()
  }

  await input.goTo(
    'approval',
    { properties, accountSetup },
    { extractionReview: normalized },
  )
  input.onSaving(false)
  return true
}
