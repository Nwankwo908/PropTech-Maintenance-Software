import { LEASE_FIELD_NAMES, type LeaseScanReview } from '@shared/onboarding/leaseScan'

function AttentionIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.75v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11" r="0.75" fill="currentColor" />
    </svg>
  )
}

export function LeaseScanSummary({ review, processing }: { review: LeaseScanReview; processing: boolean }) {
  const section = review.referenceKind === 'text_section'
  const checked = review.pagesReviewed.length
  const unit = review.pageCount === 1 ? (section ? 'text section' : 'page') : (section ? 'text sections' : 'pages')
  const needReview = LEASE_FIELD_NAMES.filter(name => review.fields[name].needsReview).length
  const scanned = !processing && review.coverageComplete && review.pageCount > 0
  const showReview = scanned && needReview > 0

  return <section className="mt-3" aria-label="Lease scan">
    <p className={`text-sm text-[#101828] ${processing || scanned ? 'font-semibold' : 'font-medium'}`}>
      {processing ? 'Checking this lease' : scanned ? 'Lease scanned' : 'Your lease is ready for review'}
    </p>
    {processing || scanned ? (
      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-[#64748b]">
        <span>{checked} of {review.pageCount} {unit} checked</span>
        {showReview ? (
          <span className="inline-flex items-center gap-1 text-[#b54708]">
            <span aria-hidden>·</span>
            <AttentionIcon />
            {needReview} {needReview === 1 ? 'detail' : 'details'} to review
          </span>
        ) : null}
      </p>
    ) : (
      <p className="mt-1 text-xs text-[#64748b]">Check the extracted details on the next step.</p>
    )}
  </section>
}
