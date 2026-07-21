import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  resolveWorkOrderToken,
  type ResolveWorkOrderTokenResult,
} from '@/api/resolveWorkOrderToken'
import {
  updateJobStatus,
  vendorPortalUpdateUrl,
} from '@/api/vendorPortalTickets'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import {
  VENDOR_TOKEN_CHANGED_EVENT,
  VENDOR_TOKEN_STORAGE_KEY,
} from '@/lib/vendorToken'

function statusLabel(status: string | null | undefined): string {
  if (status == null) return 'Open'
  const s = String(status).toLowerCase()
  if (s === 'pending_accept') return 'Awaiting accept'
  if (s === 'accepted') return 'Accepted'
  if (s === 'in_progress') return 'In progress'
  if (s === 'completed') return 'Completed'
  if (s === 'declined') return 'Declined'
  if (s === 'unassigned') return 'Unassigned'
  return String(status).replace(/_/g, ' ')
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

/** Split stored description text into readable paragraphs (not a raw line dump). */
function descriptionParagraphs(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

class JobPageErrorBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  state: { message: string | null } = { message: null }

  static getDerivedStateFromError(error: unknown) {
    return {
      message:
        error instanceof Error ? error.message : 'Something went wrong opening this job.',
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[WorkOrderPublicPage]', error, info.componentStack)
  }

  render() {
    if (this.state.message) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-[#f4f6f8] px-4">
          <div className="w-full max-w-md text-center">
            <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-semibold text-[#101828]">
              Couldn’t open this job
            </h1>
            <p className="mt-2 text-[14px] leading-6 text-[#475467]">{this.state.message}</p>
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
    return this.props.children
  }
}

/**
 * Phase 2 / 4.2 — public no-login job detail at `/w/:token`.
 */
export function WorkOrderPublicPage() {
  return (
    <JobPageErrorBoundary>
      <WorkOrderPublicPageInner />
    </JobPageErrorBoundary>
  )
}

function WorkOrderPublicPageInner() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ResolveWorkOrderTokenResult | null>(null)
  const [startingWork, setStartingWork] = useState(false)
  const [startWorkError, setStartWorkError] = useState<string | null>(null)

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

  const { job, workOrderRef, ticketId, portalApiKey } = data
  const issueLabel = job.issueCategory
    ? formatVendorTradeLabel(job.issueCategory)
    : 'Maintenance'
  const accessText =
    job.accessInstructions?.trim() || job.accessInstructionsFallback
  const appointmentText = formatWhen(
    job.appointment.scheduledAt,
    job.appointment.windowText,
  )
  const descriptionBlocks = job.description
    ? descriptionParagraphs(job.description)
    : []
  const statusKey = (job.status ?? '').toLowerCase()
  const workStarted =
    statusKey === 'in_progress' || statusKey === 'completed'
  const canStartWork =
    statusKey === 'pending_accept' || statusKey === 'accepted'
  const unitPart = job.unit?.trim()
    ? /^unit\b/i.test(job.unit.trim())
      ? job.unit.trim()
      : `Unit ${job.unit.trim()}`
    : ''
  const buildingPart = job.building?.trim() || ''
  const tenantBuildingLine =
    buildingPart && unitPart
      ? `${buildingPart} · ${unitPart}`
      : buildingPart || unitPart
  const cityState = [job.city?.trim(), job.state?.trim()].filter(Boolean).join(', ')
  const cityStateZip = [cityState, job.zipCode?.trim()].filter(Boolean).join(' ')
  const tenantStreetLine = job.streetAddress?.trim() || ''
  const tenantCityLine = cityStateZip
  const tenantLocationFallback =
    !tenantStreetLine && !tenantCityLine
      ? job.address?.trim() || tenantBuildingLine
      : ''

  async function handleStartWork() {
    if (!canStartWork || startingWork) return
    const updateUrl = vendorPortalUpdateUrl()
    const vendorToken = portalApiKey?.trim() ?? ''
    if (!updateUrl || !vendorToken) {
      setStartWorkError('Unable to start work from this link. Try again shortly.')
      return
    }
    setStartingWork(true)
    setStartWorkError(null)
    try {
      await updateJobStatus({
        ticketId,
        action: 'in_progress',
        updateUrl,
        vendorToken,
      })
      // Open vendor portal with this work order's detail rail selected.
      navigate(`/vendor/ticket/${encodeURIComponent(ticketId)}`, {
        replace: true,
      })
    } catch (err) {
      setStartWorkError(
        err instanceof Error ? err.message : 'Could not start work. Try again.',
      )
      setStartingWork(false)
    }
  }

  return (
    <div className="min-h-dvh bg-[#f4f6f8] text-[#101828]">
      <header className="border-b border-[#e5e7eb] bg-white">
        <div className="mx-auto flex max-w-lg items-start justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-[#667085]">
              Job detail
            </p>
            <h1 className="font-[family-name:var(--font-heading)] text-[22px] font-semibold leading-tight">
              {workOrderRef}
            </h1>
            <p className="mt-1 text-[14px] text-[#667085]">
              {job.unit || 'Unit'}
              {job.address ? ` · ${job.address}` : ''}
            </p>
          </div>
          <span className="shrink-0 rounded-md bg-[#eef6f8] px-2.5 py-1 text-[12px] font-semibold text-[#186179]">
            {statusLabel(job.status)}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 py-6 pb-16">
        <section className="rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="text-[15px] font-semibold leading-6 text-[#101828]">
            Description
          </h2>
          <p className="mt-1 text-[13px] leading-5 text-[#667085]">{issueLabel}</p>
          {descriptionBlocks.length > 0 ? (
            <ul className="mt-2 list-disc space-y-2 pl-5 text-[14px] leading-6 text-[#364153]">
              {descriptionBlocks.map((paragraph, index) => (
                <li key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[14px] leading-6 text-[#98a2b3]">
              No description provided.
            </p>
          )}
          {job.priority ? (
            <p className="mt-3 text-[13px] text-[#667085]">
              Priority:{' '}
              <span className="font-medium capitalize text-[#344054]">
                {job.priority}
              </span>
            </p>
          ) : null}
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
          <h2 className="text-[15px] font-semibold leading-6 text-[#101828]">
            Access instructions
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-[14px] leading-6 text-[#364153]">
            {accessText}
          </p>
        </section>

        <section className="rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="text-[15px] font-semibold leading-6 text-[#101828]">
            Tenant contact
          </h2>
          <p className="mt-1 text-[15px] font-medium">{job.tenant.name}</p>
          {tenantBuildingLine ? (
            <p className="mt-1 text-[14px] leading-5 text-[#364153]">{tenantBuildingLine}</p>
          ) : null}
          {tenantStreetLine ? (
            <p className="mt-0.5 text-[14px] leading-5 text-[#364153]">{tenantStreetLine}</p>
          ) : null}
          {tenantCityLine ? (
            <p className="mt-0.5 text-[14px] leading-5 text-[#364153]">{tenantCityLine}</p>
          ) : null}
          {tenantLocationFallback ? (
            <p className="mt-1 text-[14px] leading-5 text-[#364153]">{tenantLocationFallback}</p>
          ) : null}
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
          <h2 className="text-[15px] font-semibold leading-6 text-[#101828]">
            Appointment
          </h2>
          <p className="mt-1 text-[15px] font-medium">{appointmentText}</p>
          {job.vendorName ? (
            <p className="mt-1 text-[13px] text-[#667085]">Vendor: {job.vendorName}</p>
          ) : null}
        </section>

        <section className="rounded-xl bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
          <h2 className="text-[15px] font-semibold leading-6 text-[#101828]">
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
          <h2 className="text-[15px] font-semibold leading-6 text-[#101828]">Next Steps</h2>
          <div className="mt-3 grid gap-2">
            <ActionLink
              href={job.links.estimate}
              label={job.estimateSubmitted ? 'Estimate submitted' : 'Submit estimate'}
              variant={job.estimateSubmitted ? 'submitted' : 'primary'}
            />
            {workStarted ? (
              <Link
                to={`/vendor/ticket/${encodeURIComponent(ticketId)}`}
                title="Open this work order in the vendor portal"
                className="inline-flex items-center justify-center rounded-[10px] border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-2.5 text-[14px] font-semibold text-[#065f46] transition-colors hover:bg-[#d1fae5]"
              >
                Work started
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => void handleStartWork()}
                disabled={!canStartWork || startingWork}
                title={
                  canStartWork
                    ? 'Mark this job as in progress'
                    : 'Available after you accept this job'
                }
                className={
                  !canStartWork || startingWork
                    ? 'inline-flex cursor-not-allowed items-center justify-center rounded-[10px] border border-[#d0d5dd] bg-[#f9fafb] px-4 py-2.5 text-[14px] font-semibold text-[#98a2b3]'
                    : 'inline-flex items-center justify-center rounded-[10px] border border-[#d0d5dd] px-4 py-2.5 text-[14px] font-semibold text-[#344054] transition-colors hover:bg-[#f9fafb]'
                }
              >
                {startingWork ? 'Starting…' : 'Start work'}
              </button>
            )}
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
          </div>
          {startWorkError ? (
            <p className="mt-2 text-[13px] leading-5 text-[#b42318]">{startWorkError}</p>
          ) : null}
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
  variant?: 'primary' | 'submitted' | 'secondary'
}) {
  const className =
    variant === 'submitted'
      ? 'inline-flex items-center justify-center rounded-[10px] border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-2.5 text-[14px] font-semibold text-[#065f46] transition-colors hover:bg-[#d1fae5]'
      : disabled
        ? 'inline-flex cursor-not-allowed items-center justify-center rounded-[10px] bg-[#e4e7ec] px-4 py-2.5 text-[14px] font-semibold text-[#98a2b3]'
        : variant === 'secondary'
          ? 'inline-flex items-center justify-center rounded-[10px] border border-[#d0d5dd] px-4 py-2.5 text-[14px] font-semibold text-[#344054] transition-colors hover:bg-[#f9fafb]'
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
