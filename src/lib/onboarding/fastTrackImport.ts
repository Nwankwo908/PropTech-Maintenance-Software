/**
 * Fast-track AI review → portfolio import (document upload path).
 */
import {
  normalizeExtractionReview,
  toMockExtractionReview,
  type OnboardingExtractionReview,
} from '@/lib/onboardingDocumentUpload'
import {
  accountSetupFromReviewManual,
  mergeReviewManualAccount,
  preserveReviewContactName,
  validateReviewManualAccount,
} from '@/lib/onboardingReviewManual'
import { usableOnboardingCompanyName } from '@shared/landlordPortfolioLabel'
import { leaseDraftRequiredBlankMessage, confirmDisplayedLeaseDraft } from '@/lib/onboarding/leaseReviewDraft'
import { resolveOnboardingPropertyType } from '@/lib/onboarding/propertyType'
import { supabase } from '@/lib/supabase'
import { activateUnitsFromResidentAssignments } from '@/lib/unitActivation'
import { importMockExtraction } from './importPortfolio'
import { persistLandlordAccountProfile } from './persist/account'
import { persistOnboardingProperties, collectExtractedUnitLabels } from './persist/properties'
import { requireOnboardingLandlord } from './scope'
import type { LandlordOnboardingState, OnboardingProperty, OnboardingStep } from './types'

export type CommitFastTrackImportInput = {
  review: OnboardingExtractionReview
  accountSetup: LandlordOnboardingState['accountSetup']
  /** Caller’s current setup run — required so stale tabs cannot write. */
  onboardingSessionId: string
  onboardingSessionStartedAt?: string | null
  onError: (message: string) => void
  onExtractionReview: (review: OnboardingExtractionReview) => void
  onSaving: (saving: boolean) => void
  refreshCounts: () => Promise<void>
  goTo: (
    nextStep: OnboardingStep,
    patch?: Partial<LandlordOnboardingState>,
    forms?: { extractionReview?: OnboardingExtractionReview | null },
  ) => Promise<void>
  /** After import, continue to this step. Defaults to approval. */
  nextStep?: OnboardingStep
  onImported?: (patch: Partial<LandlordOnboardingState>) => void
}

/** Person-shaped label for "Your name" — not portfolio placeholders or company names. */
function personLikeLandlordLabel(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) return ''
  if (!usableOnboardingCompanyName(value)) return ''
  if (/\b(llc|inc|corp|management|properties|rentals)\b/i.test(value)) return ''
  if (value.split(/\s+/).filter(Boolean).length < 2) return ''
  return value
}

export async function commitFastTrackImport(
  input: CommitFastTrackImportInput,
): Promise<boolean> {
  const scope = requireOnboardingLandlord()
  if (!scope.ok) {
    input.onError(scope.error)
    return false
  }

  // Prefer the review-form account (what the user sees) over wizard accountSetup.
  let accountSeed = mergeReviewManualAccount(input.review.account, input.accountSetup)
  if (!accountSeed.contactName.trim() && supabase) {
    const { data: landlord } = await supabase
      .from('landlords')
      .select('contact_name, email, phone, name, display_name')
      .eq('id', scope.landlordId)
      .maybeSingle()
    const contactName =
      (typeof landlord?.contact_name === 'string' ? landlord.contact_name.trim() : '') ||
      personLikeLandlordLabel(
        typeof landlord?.display_name === 'string' ? landlord.display_name : '',
      ) ||
      personLikeLandlordLabel(typeof landlord?.name === 'string' ? landlord.name : '')
    if (contactName || landlord) {
      accountSeed = mergeReviewManualAccount(accountSeed, {
        contactName,
        email: typeof landlord?.email === 'string' ? landlord.email.trim() : '',
        phone: typeof landlord?.phone === 'string' ? landlord.phone.trim() : '',
        companyName:
          typeof landlord?.name === 'string'
            ? usableOnboardingCompanyName(landlord.name)
            : '',
      })
    }
  }

  const requiredBlank = leaseDraftRequiredBlankMessage(input.review)
  if (requiredBlank) {
    input.onError(requiredBlank)
    return false
  }

  const normalized = normalizeExtractionReview(
    confirmDisplayedLeaseDraft(input.review),
    accountSeed,
  )
  normalized.account = preserveReviewContactName(
    normalized.account,
    mergeReviewManualAccount(accountSeed, input.review.account),
  )
  const accountCheck = validateReviewManualAccount(normalized.account)
  if (!accountCheck.ok) {
    input.onError(accountCheck.error)
    return false
  }

  input.onExtractionReview(normalized)
  input.onSaving(true)
  try {
    const accountSetup = accountSetupFromReviewManual(normalized.account)
    const profile = await persistLandlordAccountProfile(scope.landlordId, accountSetup)
    if (!profile.ok) {
      input.onError(profile.error ?? 'Could not save account details.')
      return false
    }

    const hasImport =
      normalized.properties.some((item) => item.selected) ||
      normalized.units.some((item) => item.selected) ||
      normalized.residents.some((item) => item.selected) ||
      normalized.vendors.some((item) => item.selected) ||
      normalized.leases.some((item) => item.selected) ||
      normalized.maintenanceIssues.some((item) => item.selected) ||
      normalized.financialRecords.some((item) => item.selected)

    let properties: OnboardingProperty[] = []

    const sessionId = input.onboardingSessionId.trim()
    if (!sessionId) {
      input.onError('Missing onboarding session. Refresh and start setup again.')
      return false
    }

    if (hasImport) {
      // Build the desired property set once (with city/state/zip), then reconcile once.
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
        const unitResult = await persistOnboardingProperties(properties, scope.landlordId, {
          onboardingSessionId: sessionId,
          mode: 'reconcile',
        })
        if (!unitResult.ok) {
          input.onError(unitResult.error ?? 'Could not save property locations.')
          return false
        }
        properties = unitResult.properties
      }

      const result = await importMockExtraction(toMockExtractionReview(normalized), scope.landlordId, {
        onboardingSessionId: sessionId,
        onboardingSessionStartedAt: input.onboardingSessionStartedAt,
        skipPropertyPersist: true,
        persistedProperties: properties,
      })
      if (!result.ok) {
        input.onError(result.error ?? "We couldn't finish the import. Please try again.")
        return false
      }

      const selectedResidentCount = normalized.residents.filter((row) => row.selected).length
      if (selectedResidentCount > 0 && result.imported.residents < selectedResidentCount) {
        input.onError(
          `Could not save all residents (${result.imported.residents} of ${selectedResidentCount}). Setup was not completed.`,
        )
        return false
      }

      await activateUnitsFromResidentAssignments({
        landlordId: scope.landlordId,
        source: 'onboarding_import',
      })

      await input.refreshCounts()
    }

    const nextStep = input.nextStep ?? 'approval'
    const patch = { properties, accountSetup }
    input.onImported?.(patch)
    if (nextStep === 'review') {
      return true
    }
    await input.goTo(
      nextStep,
      patch,
      { extractionReview: normalized },
    )
    return true
  } catch (err) {
    input.onError(err instanceof Error ? err.message : "We couldn't finish the import. Please try again.")
    return false
  } finally {
    input.onSaving(false)
  }
}
