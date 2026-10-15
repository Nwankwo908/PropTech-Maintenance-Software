import { leaseFieldReviewReasons, leaseReviewIssues } from '@shared/onboarding/documentAttention'
import { LEASE_FIELD_LABELS, LEASE_FIELD_NAMES, type LeaseScanReview } from '@shared/onboarding/leaseScan'

export function LeaseScanSummary({ review, processing }: { review:LeaseScanReview;processing:boolean }) {
  const issues = leaseReviewIssues(review)
  return <section className="mt-3 rounded-lg border border-[#e5e7eb] p-3" aria-label="Extracted lease details">
    <p className="text-sm font-semibold">Lease details{processing ? ' · checking remaining fields' : ''}</p>
    <p className="mt-1 text-xs text-[#64748b]">{review.pagesProvided.length} of {review.pageCount} {review.referenceKind==='text_section'?'text sections':'pages'} provided · {!issues.pages.length && review.pageCount>0 ? 'Document coverage checked' : 'Document coverage needs review'}</p>
    {issues.pages.length ? <p className="mt-1 text-xs text-amber-800">{issues.reasons[0]}</p> : null}
    <dl className="mt-3 space-y-2">
      {LEASE_FIELD_NAMES.map(name=>{
        const field=review.fields[name]
        const reasons=leaseFieldReviewReasons(field), needsReview=reasons.length>0
        const value=Array.isArray(field.value)?field.value.join(', '):field.value
        const display=field.status==='not_stated'?'Not stated in document':value==null?'Not readable yet':['monthly_rent','security_deposit'].includes(name)?`$${Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:String(value)
        return <div key={name} className={needsReview?'rounded border border-amber-200 bg-amber-50 p-2':'py-1'}>
          <dt className="text-xs font-medium">{LEASE_FIELD_LABELS[name]}</dt>
          <dd className="mt-0.5 text-sm">{display}{needsReview?<span className="ml-2 text-xs font-semibold text-amber-800">{field.status==='conflict'?'Conflicting details · review':'Needs review'}</span>:null}</dd>
          {reasons.map(reason=><p key={reason} className="mt-1 text-xs text-amber-800">{reason}</p>)}
          {field.value!=null&&field.status!=='not_stated'?<p className="text-xs text-[#64748b]">{needsReview?`Unverified reading · reported confidence ${Math.round(field.confidence)}%`:`${Math.round(field.confidence)}% extraction confidence`}{field.pages.length?` · ${field.pages.map(page=>`${review.referenceKind==='text_section'?'section':'p.'} ${page}`).join(', ')}`:''} · {field.source==='embedded_text'?'Document text':'Scanned page'}</p>:null}
          {field.quote?<details className="mt-1 text-xs text-[#64748b]"><summary className="cursor-pointer">Source text</summary><p className="mt-1 whitespace-pre-wrap">{field.quote}</p></details>:null}
        </div>
      })}
    </dl>
  </section>
}
