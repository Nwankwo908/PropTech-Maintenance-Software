import { Link, useParams } from 'react-router-dom'

type StubKind = 'estimate' | 'upload' | 'invoice'

const COPY: Record<
  StubKind,
  { title: string; body: string }
> = {
  estimate: {
    title: 'Estimate submission',
    body: 'Tokenized estimate submit and landlord SMS approval are next. For now, use the vendor portal or reply on the job SMS thread if the property team asked for a quote.',
  },
  upload: {
    title: 'Photo upload & completion',
    body: 'A dedicated upload link is coming next. You can mark the job complete and attach photos in the vendor portal today.',
  },
  invoice: {
    title: 'Invoice submission',
    body: 'A dedicated invoice link is coming next. Platform escrow payments are deferred. You can submit invoice amounts from the vendor portal after the job is complete.',
  },
}

/** Thin placeholder pages for /estimate|/upload|/invoice/:token linked from the public job page. */
export function WorkOrderTokenActionStub({ kind }: { kind: StubKind }) {
  const { token } = useParams<{ token: string }>()
  const copy = COPY[kind]
  const back = token?.trim() ? `/w/${encodeURIComponent(token.trim())}` : '/vendor'

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f4f6f8] px-4">
      <div className="w-full max-w-md rounded-xl bg-white px-5 py-6 shadow-[0_1px_2px_rgba(16,24,40,0.06)]">
        <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#667085]">
          Coming soon
        </p>
        <h1 className="mt-1 font-[family-name:var(--font-heading)] text-[22px] font-semibold text-[#101828]">
          {copy.title}
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-[#475467]">{copy.body}</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            to={back}
            className="inline-flex items-center justify-center rounded-[10px] bg-[#186179] px-4 py-2.5 text-[14px] font-semibold text-white hover:bg-[#145066]"
          >
            Back to job details
          </Link>
          <Link
            to="/vendor"
            className="inline-flex items-center justify-center rounded-[10px] border border-[#d0d5dd] px-4 py-2.5 text-[14px] font-semibold text-[#344054] hover:bg-[#f9fafb]"
          >
            Open vendor portal
          </Link>
        </div>
      </div>
    </div>
  )
}
