/**
 * Public result page after landlord taps Approve / Decline on an estimate link.
 * Edge Function processes the action then 302s here (HTML cannot be served from
 * *.supabase.co functions — gateway rewrites text/html → text/plain).
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#f9fafb] px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-[480px] rounded-[20px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_8px_24px_rgba(0,0,0,0.06)] sm:p-8">
        {children}
      </div>
    </div>
  )
}

type DecisionView = {
  title: string
  body: string
}

function resolveView(params: URLSearchParams): DecisionView {
  const status = (params.get('status') ?? '').trim().toLowerCase()
  const already = params.get('already') === '1'
  const custom = (params.get('message') ?? '').trim()

  if (status === 'approved') {
    return {
      title: already ? 'Already approved' : 'Estimate approved',
      body:
        custom ||
        (already
          ? 'This estimate was already approved. The vendor was notified.'
          : 'Thanks - the vendor has been notified that they can proceed.'),
    }
  }

  if (status === 'rejected' || status === 'declined') {
    return {
      title: already ? 'Already declined' : 'Estimate declined',
      body:
        custom ||
        (already
          ? 'This estimate was already declined. The vendor was notified.'
          : 'Got it - the vendor has been notified that this estimate was not approved.'),
    }
  }

  return {
    title: 'Could not update estimate',
    body:
      custom ||
      'This approval link is invalid or expired. Ask for a new estimate notification, or open the admin dashboard.',
  }
}

export function EstimateDecisionResultPage() {
  const [params] = useSearchParams()
  const view = useMemo(() => resolveView(params), [params])

  return (
    <Shell>
      <p className="text-[13px] font-medium tracking-wide text-[#186179] uppercase">
        Ulo
      </p>
      <h1 className="mt-2 text-[22px] font-semibold tracking-[-0.02em] text-[#101828]">
        {view.title}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-[#364153]">{view.body}</p>
    </Shell>
  )
}
