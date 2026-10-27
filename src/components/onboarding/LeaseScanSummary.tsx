import type { LeaseScanReview } from '@shared/onboarding/leaseScan'

export function LeaseScanSummary({ review, processing }: { review: LeaseScanReview; processing: boolean }) {
  const section = review.referenceKind === 'text_section'
  const checked = review.pagesReviewed.length
  const unit = review.pageCount === 1 ? (section ? 'text section' : 'page') : (section ? 'text sections' : 'pages')

  if (!processing) {
    return <section className="mt-3" aria-label="Lease scan">
      <p className="text-sm font-medium text-[#101828]">Your lease is ready for review</p>
      <p className="mt-1 text-xs text-[#64748b]">Check the extracted details on the next step.</p>
    </section>
  }

  return <section className="mt-3" aria-label="Lease scan">
    <p className="text-sm font-semibold text-[#101828]">Checking this lease</p>
    <p className="mt-1 text-xs text-[#64748b]">{checked} of {review.pageCount} {unit} checked</p>
  </section>
}
