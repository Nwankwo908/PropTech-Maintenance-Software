import { expect, it, vi } from 'vitest'
vi.mock('@/api/onboardingDocumentExtract', () => ({ extractOnboardingDocument: vi.fn() }))
vi.mock('@/lib/pdfPageImagesBrowser', () => ({ extractPdfPageTexts: vi.fn(), renderPdfFileToJpegDataUrls: vi.fn() }))
import { extractOnboardingDocument } from '@/api/onboardingDocumentExtract'
import { renderPdfFileToJpegDataUrls } from '@/lib/pdfPageImagesBrowser'
import { createUploadedDocumentFromFile, runDocumentProcessing, type OnboardingUploadedDocument } from './onboardingDocumentUpload'
import { normalizeLeaseScan } from '@shared/onboarding/leaseScan'
import { leaseFixture } from '@shared/onboarding/leaseScan.fixtures'

const payload = () => ({ account: {}, properties: [], units: [], residents: [], vendors: [], leases: [], maintenanceIssues: [], financialRecords: [], imageLabels: [], warnings: [], leaseReview: normalizeLeaseScan(leaseFixture(), ['']).review })
it('keeps a finished lease ready to continue when a detail still needs review', async () => {
  const file = new File(['%PDF fixture'], 'lease.pdf', { type: 'application/pdf' })
  const updates: OnboardingUploadedDocument[] = [], extracted = payload()
  extracted.leaseReview.fields.monthly_rent.needsReview = true
  extracted.leaseReview.fields.monthly_rent.status = 'uncertain'
  extracted.leaseReview.fields.monthly_rent.reviewReasons = ['Check the supporting source text.']
  vi.mocked(extractOnboardingDocument).mockImplementationOnce(async input => {
    input.onProgress?.({ stage: 'recovering', extracted })
    expect(updates.at(-1)?.extractedPayload?.leaseReview).toEqual(extracted.leaseReview)
    expect(updates.at(-1)?.uploadStatus).toBe('extracting')
    return { extracted, hasData: true, needsAttention: true }
  })
  const final = await runDocumentProcessing(createUploadedDocumentFromFile(file), file, updated => updates.push(updated))
  expect(renderPdfFileToJpegDataUrls).not.toHaveBeenCalled()
  expect(final.uploadStatus).toBe('ready_for_review')
  expect(final.errorMessage).toBeNull()
})
it('clears a generic attention flag when all structured fields and page coverage pass', async () => {
  const file = new File(['fixture'], 'lease.pdf', { type: 'application/pdf' }), extracted = payload()
  extracted.warnings = ['Signatures are not parsed. Upload PDF for signature details.']
  for (const field of Object.values(extracted.leaseReview.fields)) field.confidence = 100
  vi.mocked(extractOnboardingDocument).mockResolvedValueOnce({ extracted, hasData: true, needsAttention: true })
  const final = await runDocumentProcessing(createUploadedDocumentFromFile(file), file, () => {})
  expect(final.uploadStatus).toBe('ready_for_review')
  expect(final.errorMessage).toBeNull()
})
it('shows a page-coverage message when all fields are validated at 100%', async () => {
  const file = new File(['fixture'], 'lease.pdf', { type: 'application/pdf' }), extracted = payload()
  for (const field of Object.values(extracted.leaseReview.fields)) field.confidence = 100
  extracted.leaseReview.pageCount = 2
  extracted.leaseReview.pagesProvided = [1, 2]
  extracted.leaseReview.coverageComplete = false
  vi.mocked(extractOnboardingDocument).mockResolvedValueOnce({ extracted, hasData: true, needsAttention: true })
  const final = await runDocumentProcessing(createUploadedDocumentFromFile(file), file, () => {})
  expect(final.uploadStatus).toBe('needs_attention')
  expect(final.errorMessage).toBeNull()
  expect(final.extractedPayload?.leaseReview?.coverageComplete).toBe(false)
})
it('keeps partial details visible if the response stream fails', async () => {
  const file = new File(['fixture'], 'lease.pdf', { type: 'application/pdf' }), extracted = payload()
  vi.mocked(extractOnboardingDocument).mockImplementationOnce(async input => { input.onProgress?.({ stage: 'checking', extracted }); throw new Error('Stream interrupted') })
  const final = await runDocumentProcessing(createUploadedDocumentFromFile(file), file, () => {})
  expect(final.uploadStatus).toBe('failed')
  expect(final.extractedPayload?.leaseReview).toEqual(extracted.leaseReview)
})
