import { LEASE_FIELD_LABELS, LEASE_FIELD_NAMES, type LeaseScanReview } from '@shared/onboarding/leaseScan'

export function LeaseScanSummary({ review, processing }: { review:LeaseScanReview;processing:boolean }) {
  return <section className="mt-3 rounded-lg border border-[#e5e7eb] p-3" aria-label="Extracted lease details">
    <p className="text-sm font-semibold">Lease details{processing ? ' · checking remaining fields' : ''}</p>
    <p className="mt-1 text-xs text-[#64748b]">{review.pagesProvided.length} of {review.pageCount} {review.referenceKind==='text_section'?'text sections':'pages'} provided · {review.coverageComplete ? 'Document coverage checked' : 'Document coverage needs review'}</p>
    <dl className="mt-3 space-y-2">
      {LEASE_FIELD_NAMES.map(name=>{
        const field=review.fields[name]
        const value=Array.isArray(field.value)?field.value.join(', '):field.value
        const display=field.status==='not_stated'?'Not stated in document':value==null?'Not readable yet':['monthly_rent','security_deposit'].includes(name)?`$${Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`:String(value)
        return <div key={name} className={field.needsReview?'rounded border border-amber-200 bg-amber-50 p-2':'py-1'}>
          <dt className="text-xs font-medium">{LEASE_FIELD_LABELS[name]}</dt>
          <dd className="mt-0.5 text-sm">{display}{field.needsReview?<span className="ml-2 text-xs font-semibold text-amber-800">{field.status==='conflict'?'Conflicting details · review':'Needs review'}</span>:null}</dd>
          {field.value!=null&&field.status!=='not_stated'?<p className="text-xs text-[#64748b]">{Math.round(field.confidence)}% confidence{field.pages.length?` · ${field.pages.map(page=>`${review.referenceKind==='text_section'?'section':'p.'} ${page}`).join(', ')}`:''} · {field.source==='embedded_text'?'Document text':'Scanned page'}</p>:null}
          {field.quote?<details className="mt-1 text-xs text-[#64748b]"><summary className="cursor-pointer">Source text</summary><p className="mt-1 whitespace-pre-wrap">{field.quote}</p></details>:null}
        </div>
      })}
    </dl>
  </section>
}
