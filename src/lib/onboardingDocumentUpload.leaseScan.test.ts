import { expect, it, vi } from 'vitest'
vi.mock('@/api/onboardingDocumentExtract', () => ({ extractOnboardingDocument: vi.fn() }))
vi.mock('@/lib/pdfPageImagesBrowser', () => ({ extractPdfPageTexts: vi.fn(), renderPdfFileToJpegDataUrls: vi.fn() }))
import { extractOnboardingDocument } from '@/api/onboardingDocumentExtract'
import { renderPdfFileToJpegDataUrls } from '@/lib/pdfPageImagesBrowser'
import { createUploadedDocumentFromFile, runDocumentProcessing, type OnboardingUploadedDocument } from './onboardingDocumentUpload'
import { normalizeLeaseScan } from '@shared/onboarding/leaseScan'
import { leaseFixture } from '@shared/onboarding/leaseScan.fixtures'

const payload = () => ({ account: {}, properties: [], units: [], residents: [], vendors: [], leases: [], maintenanceIssues: [], financialRecords: [], imageLabels: [], warnings: [], leaseReview: normalizeLeaseScan(leaseFixture(), ['']).review })
it('shows partial fields during the original upload and honors the server review flag', async () => {
  const file = new File(['%PDF fixture'], 'lease.pdf', { type: 'application/pdf' })
  const updates: OnboardingUploadedDocument[] = [], extracted = payload()
  vi.mocked(extractOnboardingDocument).mockImplementationOnce(async input => {
    input.onProgress?.({ stage: 'recovering', extracted })
    expect(updates.at(-1)?.extractedPayload?.leaseReview).toEqual(extracted.leaseReview)
    expect(updates.at(-1)?.uploadStatus).toBe('extracting')
    return { extracted, hasData: true, needsAttention: true }
  })
  const final = await runDocumentProcessing(createUploadedDocumentFromFile(file), file, updated => updates.push(updated))
  expect(renderPdfFileToJpegDataUrls).not.toHaveBeenCalled()
  expect(final.uploadStatus).toBe('needs_attention')
  expect(final.errorMessage).toContain('Readable fields are shown below')
})
it('keeps partial details visible if the response stream fails', async () => {
  const file = new File(['fixture'], 'lease.pdf', { type: 'application/pdf' }), extracted = payload()
  vi.mocked(extractOnboardingDocument).mockImplementationOnce(async input => { input.onProgress?.({ stage: 'checking', extracted }); throw new Error('Stream interrupted') })
  const final = await runDocumentProcessing(createUploadedDocumentFromFile(file), file, () => {})
  expect(final.uploadStatus).toBe('failed')
  expect(final.extractedPayload?.leaseReview).toEqual(extracted.leaseReview)
})
