import { Link } from 'react-router-dom'

const sectionCardClass =
  'sa-surface rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]'

export function AdminConnectedEmailSettings() {
  return (
    <>
      <div className="py-6">
        <Link
          to="/admin/settings"
          className="sa-link inline-flex items-center gap-1.5 text-[14px] font-medium tracking-[-0.1504px] text-[#6a7282] hover:text-[#101828]"
        >
          <span aria-hidden>←</span>
          Settings
        </Link>

        <div className="mt-4 max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
              Connected Email
            </h1>
            <span className="inline-flex rounded-full border border-[#e5e7eb] bg-[#f9fafb] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#6a7282]">
              Coming soon
            </span>
          </div>
          <p className="mt-2 text-[14px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
            Email integration is not available during the Alpha program yet. When it launches, you
            will be able to connect Gmail, Outlook, or Microsoft 365 so Ulo can find property
            documents — with nothing imported without your approval.
          </p>
        </div>
      </div>

      <section className={sectionCardClass}>
        <div className="flex flex-col items-center px-4 py-10 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-[#f3f4f6] text-[#6a7282]">
            <svg className="size-7" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 7L12 13L21 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <p className="mt-5 text-[18px] font-semibold tracking-[-0.02em] text-[#101828]">
            Not connected
          </p>
          <p className="mt-2 max-w-lg text-[14px] leading-6 tracking-[-0.1504px] text-[#6a7282]">
            Connect an email account to let Ulo find leases, invoices, inspection reports, and other
            property documents. We will notify Alpha customers when this is ready.
          </p>
        </div>
      </section>
    </>
  )
}
