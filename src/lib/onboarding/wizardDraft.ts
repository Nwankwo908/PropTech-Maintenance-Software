/**
 * Onboarding wizard form draft — build + read persisted fast-track payloads.
 */
import {
  hasExtractionReviewData,
  type OnboardingExtractionReview,
  type OnboardingUploadedDocument,
} from '@/lib/onboardingDocumentUpload'
import { readLocalOnboardingState } from './draftStorage'
import type {
  OnboardingFormDraft,
  PropertyFormRow,
  ResidentFormRow,
  VendorFormRow,
} from './types'

export function buildOnboardingFormDraft(
  propertyForms: PropertyFormRow[],
  vendorForms: VendorFormRow[],
  residentForms: ResidentFormRow[],
  fastTrack?: {
    uploadDocuments?: OnboardingUploadedDocument[]
    extractionReview?: OnboardingExtractionReview | null
  },
): OnboardingFormDraft {
  const draft: OnboardingFormDraft = { propertyForms, vendorForms, residentForms }
  if (fastTrack?.uploadDocuments?.length) {
    draft.uploadDocuments = fastTrack.uploadDocuments
  }
  if (fastTrack?.extractionReview && hasExtractionReviewData(fastTrack.extractionReview)) {
    draft.extractionReview = fastTrack.extractionReview
  }
  // Explicit null clears a previously persisted AI review (Back → Upload).
  if (fastTrack && 'extractionReview' in fastTrack && fastTrack.extractionReview == null) {
    delete draft.extractionReview
  }
  return draft
}

export function readPersistedExtractionReview(
  stateDraft: OnboardingFormDraft | undefined,
): OnboardingExtractionReview | undefined {
  if (stateDraft?.extractionReview && hasExtractionReviewData(stateDraft.extractionReview)) {
    return stateDraft.extractionReview
  }
  const localDraft = readLocalOnboardingState()?.formDraft
  if (localDraft?.extractionReview && hasExtractionReviewData(localDraft.extractionReview)) {
    return localDraft.extractionReview
  }
  return undefined
}

export function readPersistedUploadDocuments(
  stateDraft: OnboardingFormDraft | undefined,
): OnboardingUploadedDocument[] | undefined {
  if (stateDraft?.uploadDocuments?.length) {
    return stateDraft.uploadDocuments
  }
  const localDraft = readLocalOnboardingState()?.formDraft
  if (localDraft?.uploadDocuments?.length) {
    return localDraft.uploadDocuments
  }
  return undefined
}
