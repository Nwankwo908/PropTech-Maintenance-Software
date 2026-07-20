import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  resolveWorkOrderToken,
  type ResolveWorkOrderTokenResult,
} from '@/api/resolveWorkOrderToken'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import {
  VENDOR_TOKEN_CHANGED_EVENT,
  VENDOR_TOKEN_STORAGE_KEY,
} from '@/lib/vendorToken'

function statusLabel(status: string | null): string {
  if (!status) return 'Open'
  const s = status.toLowerCase()
  if (s === 'pending_accept') return 'Awaiting accept'
  if (s === 'accepted') return 'Accepted'
  if (s === 'in_progress') return 'In progress'
  if (s === 'completed') return 'Completed'
  if (s === 'declined') return 'Declined'
  if (s === 'unassigned') return 'Unassigned'
  return status.replace(/_/g, ' ')
}

function formatWhen(iso: string | null, windowText: string | null): string {
  if (windowText?.trim()) return windowText.trim()
  if (!iso) return 'Not scheduled yet'
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatHistoryDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

/**
 * Phase 2 / 4.2 — public no-login job detail at `/w/:token`.
 */
export function WorkOrderPublicPage() {
  const { token } = useParams<{ token: string }>()
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ResolveWorkOrderTokenResult | null>(null)

  useEffect(() => {
    let cancelled = false
    const t = token?.trim() ?? ''
    if (!t) {
      setError('This job link is missing a token.')
      return
    }

    void (async () => {
      try {
        const result = await resolveWorkOrderToken(t)
        if (cancelled) return
        if (result.portalApiKey) {
          try {
            localStorage.setItem(VENDOR_TOKEN_STORAGE_KEY, result.portalApiKey)
            window.dispatchEvent(new Event(VENDOR_TOKEN_CHANGED_EVENT))
          } catch {
            /* ignore */
          }
        }
        setData(result)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error
            ? err.message
            : 'This job link is invalid or has expired.',
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token])

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f4f6f8] px-4">
        <div className="w-full max-w-md text-center">
          <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-semibold text-[#101828]">
            Couldn’t open this job
          </h1>
          <p className="mt-2 text-[14px] leading-6 text-[#475467]">{error}</p>
          <Link
            to="/vendor"
            className="mt-6 inline-flex text-[14px] font-semibold text-[#186179] hover:underline"
          >
            Go to vendor portal
          </Link>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f4f6f8] px-4">
        <p className="text-[14px] text-[#475467]">Loading job…</p>
      </div>
    )
  }

  const { job, workOrderRef, portalPath } = data
  const issueLabel = job.issueCategory
    ? formatVendorTradeLabel(job.issueCategory)
    : 'Maintenance'
  const accessText =
    job.accessInstructions?.trim() || job.accessInstructionsFallback
  const appointmentText = formatWhen(
    job.appointment.scheduledAt,
    job.appointment.windowText,
  )

  return (
    <div className="min-h-dvh bg-[#f4f6f8] text-[#101828]">
      <header className="border-b border-[#e5e7eb] bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#667085]">
              Work order
            </p>
            <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-tight">
              {workOrderRef}
            </h1>
          </div>
          <span className="rounded-md bg-[#eef6f8] px-2.5 py-1 text-[12px] font-semibold text-[#186179]">
            {statusLabel(job.status)}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 pb-16">
        <section className="rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="text-[13px] font-semibold text-[#667085]">Address</h2>
          <p className="mt-1 text-[16px] font-medium leading-6">{job.address}</p>
          {job.priority ? (
            <p className="mt-2 text-[13px] text-[#667085]">
              Priority:{' '}
              <span className="font-medium capitalize text-[#344054]">
                {job.priority}
              </span>
            </p>
          ) : null}
        </section>

        <section className="rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="text-[13px] font-semibold text-[#667085]">Issue</h2>
          <p className="mt-1 text-[15px] font-medium">{issueLabel}</p>
          <p className="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-[#364153]">
            {job.description || 'No description provided.'}
          </p>
          {job.photoUrls.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {job.photoUrls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-lg bg-[#f2f4f7]"
                >
                  <img
                    src={url}
                    alt="Tenant photo for this work order"
                    className="aspect-square w-full object-cover"
                  />
                </a>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-[#98a2b3]">No tenant photos attached.</p>
          )}
        </section>

        <section className="rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="text-[13px] font-semibold text-[#667085]">
            Access instructions
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-[#364153]">
            {accessText}
          </p>
        </section>

        <section className="rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="text-[13px] font-semibold text-[#667085]">Tenant contact</h2>
          <p className="mt-1 text-[15px] font-medium">{job.tenant.name}</p>
          {job.tenant.phone ? (
            <a
              href={`tel:${job.tenant.phone}`}
              className="mt-1 inline-block text-[14px] font-medium text-[#186179] hover:underline"
            >
              {job.tenant.phone}
            </a>
          ) : (
            <p className="mt-1 text-[13px] text-[#98a2b3]">No phone on file</p>
          )}
        </section>

        <section className="rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="text-[13px] font-semibold text-[#667085]">Appointment</h2>
          <p className="mt-1 text-[15px] font-medium">{appointmentText}</p>
          {job.vendorName ? (
            <p className="mt-1 text-[13px] text-[#667085]">Vendor: {job.vendorName}</p>
          ) : null}
        </section>

        <section className="rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="text-[13px] font-semibold text-[#667085]">
            Property job history
          </h2>
          {job.propertyHistory.length === 0 ? (
            <p className="mt-2 text-[13px] text-[#98a2b3]">
              No other recent jobs at this property.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[#f2f4f7]">
              {job.propertyHistory.map((item) => (
                <li key={item.ticketId} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13px] font-semibold text-[#186179]">
                      {item.workOrderRef}
                    </p>
                    <p className="text-[12px] text-[#98a2b3]">
                      {formatHistoryDate(item.createdAt)}
                    </p>
                  </div>
                  <p className="mt-0.5 text-[13px] text-[#667085]">
                    {item.unit || 'Unit'} · {statusLabel(item.status)}
                  </p>
                  {item.description ? (
                    <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-[#364153]">
                      {item.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="text-[13px] font-semibold text-[#667085]">Actions</h2>
          <div className="mt-3 grid gap-2">
            <ActionLink
              href={job.links.estimate}
              label={job.estimateSubmitted ? 'Estimate submitted' : 'Submit estimate'}
              variant={job.estimateSubmitted ? 'submitted' : 'primary'}
            />
            <ActionLink
              href={job.links.upload}
              label="Upload completion photos"
              disabled={!job.estimateApproved}
              disabledHint="Available after your estimate is approved"
            />
            <ActionLink
              href={job.links.invoice}
              label="Submit invoice"
              disabled={!job.estimateApproved || !job.completionPhotosUploaded}
              disabledHint={
                !job.estimateApproved
                  ? 'Available after your estimate is approved'
                  : 'Available after you upload completion photos'
              }
            />
            <Link
              to={portalPath}
              className="mt-1 inline-flex items-center justify-center rounded-[10px] border border-[#d0d5dd] px-4 py-2.5 text-[14px] font-semibold text-[#344054] transition-colors hover:bg-[#f9fafb]"
            >
              Open full vendor portal
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}

function ActionLink({
  href,
  label,
  disabled = false,
  disabledHint,
  variant = 'primary',
}: {
  href: string
  label: string
  disabled?: boolean
  disabledHint?: string
  variant?: 'primary' | 'submitted'
}) {
  const className =
    variant === 'submitted'
      ? 'inline-flex items-center justify-center rounded-[10px] border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-2.5 text-[14px] font-semibold text-[#065f46] transition-colors hover:bg-[#d1fae5]'
      : disabled
        ? 'inline-flex cursor-not-allowed items-center justify-center rounded-[10px] bg-[#e4e7ec] px-4 py-2.5 text-[14px] font-semibold text-[#98a2b3]'
        : 'inline-flex items-center justify-center rounded-[10px] bg-[#186179] px-4 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#145066]'

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title={disabledHint}
        aria-disabled="true"
        className={className}
      >
        {label}
      </button>
    )
  }

  const isExternal = /^https?:\/\//i.test(href)
  if (isExternal) {
    try {
      const u = new URL(href)
      if (u.origin === window.location.origin) {
        return (
          <Link to={`${u.pathname}${u.search}`} className={className}>
            {label}
          </Link>
        )
      }
    } catch {
      /* fall through */
    }
    return (
      <a href={href} className={className}>
        {label}
      </a>
    )
  }

  return (
    <Link to={href} className={className}>
      {label}
    </Link>
  )
}
