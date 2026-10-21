import { describe, expect, it } from 'vitest'
import { buildOnboardingFormDraft } from './wizardDraft'
import type { OnboardingUploadedDocument } from '@/lib/onboardingDocumentUpload'

const emptyRow = {
  propertyForms: [],
  vendorForms: [],
  residentForms: [],
}

const doc = {
  id: 'doc-1',
  fileName: 'lease.pdf',
  fileType: 'pdf',
  fileSize: 12,
  documentCategory: 'lease_agreement',
  categoryGroup: 'resident',
  uploadStatus: 'ready_for_review',
  extractionStatus: 'ready_for_review',
  processingLabel: 'Ready for review',
  uploadProgress: 100,
  errorMessage: null,
  extractedPayload: null,
  imageLabels: [],
  hasHandwriting: false,
} as OnboardingUploadedDocument

describe('buildOnboardingFormDraft', () => {
  it('persists an empty upload list so Remove is not undone by the last saved files', () => {
    const withFiles = buildOnboardingFormDraft(
      emptyRow.propertyForms,
      emptyRow.vendorForms,
      emptyRow.residentForms,
      { uploadDocuments: [doc] },
    )
    expect(withFiles.uploadDocuments).toEqual([doc])

    const cleared = buildOnboardingFormDraft(
      emptyRow.propertyForms,
      emptyRow.vendorForms,
      emptyRow.residentForms,
      { uploadDocuments: [] },
    )
    expect(cleared.uploadDocuments).toEqual([])
  })
})
