import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingAiReviewStep } from '@/components/onboarding/OnboardingAiReviewStep'
import { buildOnboardingExtractionReview } from '@/lib/onboardingDocumentUpload'
import { normalizeLeaseScan } from '@shared/onboarding/leaseScan'
import { leaseFixture } from '@shared/onboarding/leaseScan.fixtures'

function reviewWith(overrides: Record<string, { status: string; value: unknown }>) {
  const raw = leaseFixture()
  for (const [name, patch] of Object.entries(overrides)) {
    raw.fields[name as keyof typeof raw.fields] = { ...raw.fields[name as keyof typeof raw.fields], ...patch }
  }
  const scanned = normalizeLeaseScan(raw, ['Lease terms']).review
  return buildOnboardingExtractionReview([
    {
      id: 'doc-lease',
      fileName: 'Lease.pdf',
      fileType: 'pdf',
      fileSize: 12,
      documentCategory: 'lease_agreement',
      categoryGroup: 'resident',
      uploadStatus: 'ready_for_review',
      uploadProgress: 100,
      extractionStatus: 'ready_for_review',
      processingLabel: 'Ready for review',
      errorMessage: null,
      imageLabels: [],
      hasHandwriting: false,
      extractedPayload: {
        properties: [],
        units: [],
        residents: [],
        vendors: [],
        leases: [],
        maintenanceIssues: [],
        financialRecords: [],
        imageLabels: [],
        warnings: [],
        leaseReview: scanned,
      },
    },
  ])
}

describe('onboarding review required blanks', () => {
  it('keeps a blank required tenant on screen and blocks Continue', () => {
    const onImportAll = vi.fn()
    const html = renderToStaticMarkup(
      <MemoryRouter>
      <OnboardingAiReviewStep
        review={reviewWith({ tenant_names: { status: 'not_stated', value: null } })}
        saving={false}
        onReviewChange={() => undefined}
        onBackToUploads={() => undefined}
        onImportAll={onImportAll}
      />
      </MemoryRouter>,
    )
    expect(html).toContain('Enter the lease details marked Required before continuing.')
    expect(html).toContain('Required')
    expect(html).toContain('value="1500"')
    expect(html).toContain('Verified')
    expect(onImportAll).not.toHaveBeenCalled()
  })
})
