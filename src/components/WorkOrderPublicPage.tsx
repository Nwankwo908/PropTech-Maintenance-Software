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
import {
  normalizePropertyAccess,
  propertyAccessDisplayRows,
} from '@/lib/propertyAccess'
import { formatVendorTradeLabel } from '@/lib/vendorTrades'
import {
  VENDOR_TOKEN_CHANGED_EVENT,
  VENDOR_TOKEN_STORAGE_KEY,
} from '@/lib/vendorToken'
import { getErrorMessage } from '@/lib/errorMessage'

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
        getErrorMessage(error, 'Something went wrong opening this job.'),
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[WorkOrderPublicPage]', error, info.componentStack)
  }

  render() {
    if (this.state.message) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-[#f9fafb] px-4 font-[family-name:var(--font-admin)]">
          <div className="w-full max-w-md text-center">
          <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
            Couldn’t open this job
          </h1>
          <p className="mt-2 text-[14px] leading-5 text-[#6a7282]">{this.state.message}</p>
          <p className="mt-6 text-[14px] leading-5 text-[#6a7282]">
            Open the unique job link from your text message to continue.
          </p>
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
        const sessionToken = result.portalApiKey?.trim() || t
        try {
          localStorage.setItem(VENDOR_TOKEN_STORAGE_KEY, sessionToken)
          window.dispatchEvent(new Event(VENDOR_TOKEN_CHANGED_EVENT))
        } catch {
          /* ignore */
        }
        setData(result)
      } catch (err) {
        if (cancelled) return
        setError(
          getErrorMessage(err, 'This job link is invalid or has expired.'),
        )
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token])

  if (error) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f9fafb] px-4 font-[family-name:var(--font-admin)]">
        <div className="w-full max-w-md text-center">
          <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
            Couldn’t open this job
          </h1>
          <p className="mt-2 text-[14px] leading-5 text-[#6a7282]">{error}</p>
          {token?.trim() ? (
            <Link
              to={`/w/${encodeURIComponent(token.trim())}`}
              className="sa-link mt-6 inline-flex text-[14px] font-medium text-[#186179]"
            >
              Try this job link again
            </Link>
          ) : (
            <p className="mt-6 text-[14px] leading-5 text-[#6a7282]">
              Open the unique job link from your text message to continue.
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f9fafb] px-4 font-[family-name:var(--font-admin)]">
        <p className="text-[14px] text-[#6a7282]">Loading job…</p>
      </div>
    )
  }

  const { job, workOrderRef, ticketId, portalApiKey } = data
  const issueLabel = job.issueCategory
    ? formatVendorTradeLabel(job.issueCategory)
    : 'Maintenance'
  const accessRows = job.propertyAccess
    ? propertyAccessDisplayRows(normalizePropertyAccess(job.propertyAccess))
    : []
  const ticketAccessNotes = job.accessInstructions?.trim() || ''
  const accessFallback = job.accessInstructionsFallback
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
  const unitRaw = job.unit?.trim() || ''
  const buildingRaw = job.building?.trim() || ''
  const unitLooksLikeAddress =
    unitRaw.length > 12 || /,\s*[A-Z]{2}\b/.test(unitRaw) || /\d{5}(-\d{4})?/.test(unitRaw)
  const buildingLooksLikeUnit = /^(unit\s*)?[\w-]{1,6}$/i.test(buildingRaw)
  const unitPart =
    unitRaw && !unitLooksLikeAddress
      ? /^unit\b/i.test(unitRaw)
        ? unitRaw
        : `Unit ${unitRaw}`
      : ''
  const tenantUnitLine = unitPart
  const cityState = [job.city?.trim(), job.state?.trim()].filter(Boolean).join(', ')
  const cityStateZip = [cityState, job.zipCode?.trim()].filter(Boolean).join(' ')
  const tenantStreetLine = job.streetAddress?.trim() || ''
  const tenantCityLine = cityStateZip
  const addressFallback = job.address?.trim() || ''
  const tenantLocationFallback =
    !tenantStreetLine && !tenantCityLine && addressFallback && addressFallback !== buildingRaw
      ? addressFallback
      : !tenantStreetLine && !tenantCityLine && !buildingLooksLikeUnit
        ? buildingRaw
        : ''

  async function handleStartWork() {
    if (!canStartWork || startingWork) return
    const updateUrl = vendorPortalUpdateUrl()
    const vendorToken = portalApiKey?.trim() || token?.trim() || ''
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
        getErrorMessage(err, 'Could not start work. Try again.'),
      )
      setStartingWork(false)
    }
  }

  return (
    <div className="min-h-dvh bg-[#f9fafb] font-[family-name:var(--font-admin)] text-[#0a0a0a]">
      <header className="border-b border-[#e5e7eb] bg-white">
        <div className="mx-auto flex max-w-lg items-start justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            <p className="text-[13px] font-medium leading-5 text-[#6a7282]">Job detail</p>
            <h1 className="text-[24px] font-semibold leading-8 tracking-[0.0703px] text-[#0a0a0a]">
              {workOrderRef}
            </h1>
          </div>
          <span className="inline-flex shrink-0 rounded-[4px] bg-[#e0f2fe] px-2 py-0.5 text-[10px] font-semibold tracking-[0.06em] text-[#0369a1]">
            {statusLabel(job.status)}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 py-6 pb-16">
        <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <h2 className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">Description</h2>
          <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">{issueLabel}</p>
          {descriptionBlocks.length > 0 ? (
            <ul className="mt-2 list-disc space-y-2 pl-5 text-[14px] leading-5 text-[#364153]">
              {descriptionBlocks.map((paragraph, index) => (
                <li key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[14px] leading-5 text-[#6a7282]">No description provided.</p>
          )}
          {job.priority ? (
            <p className="mt-3 text-[13px] leading-5 text-[#6a7282]">
              Priority:{' '}
              <span className="font-medium capitalize text-[#0a0a0a]">{job.priority}</span>
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
                  className="block overflow-hidden rounded-[10px] bg-[#f3f4f6]"
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
            <p className="mt-3 text-[13px] leading-5 text-[#6a7282]">No tenant photos attached.</p>
          )}
        </section>

        <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <h2 className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">Property access</h2>
          {accessRows.length > 0 ? (
            <dl className="mt-3 space-y-3">
              {accessRows.map((row) => (
                <div key={row.label}>
                  <dt className="text-[12px] leading-4 text-[#6a7282]">{row.label}</dt>
                  <dd className="mt-0.5 text-[14px] font-medium leading-5 text-[#0a0a0a]">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-[14px] leading-5 text-[#364153]">
              {ticketAccessNotes || accessFallback}
            </p>
          )}
          {accessRows.length > 0 && ticketAccessNotes ? (
            <div className="mt-4 border-t border-[#f3f4f6] pt-3">
              <p className="text-[12px] leading-4 text-[#6a7282]">Job-specific notes</p>
              <p className="mt-1 whitespace-pre-wrap text-[14px] leading-5 text-[#364153]">
                {ticketAccessNotes}
              </p>
            </div>
          ) : null}
        </section>

        <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <h2 className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">Tenant contact</h2>
          <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">{job.tenant.name}</p>
          {tenantUnitLine ? (
            <p className="mt-1 text-[14px] leading-5 text-[#364153]">{tenantUnitLine}</p>
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
              className="sa-link mt-1 inline-block text-[14px] font-medium text-[#186179]"
            >
              {job.tenant.phone}
            </a>
          ) : (
            <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">No phone on file</p>
          )}
        </section>

        <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <h2 className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">Appointment</h2>
          <p className="mt-1 text-[14px] font-semibold leading-5 text-[#0a0a0a]">{appointmentText}</p>
          {job.vendorName ? (
            <p className="mt-1 text-[13px] leading-5 text-[#6a7282]">Vendor: {job.vendorName}</p>
          ) : null}
        </section>

        <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <h2 className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">
            Property job history
          </h2>
          {job.propertyHistory.length === 0 ? (
            <p className="mt-2 text-[13px] leading-5 text-[#6a7282]">
              No other recent jobs at this property.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[#f3f4f6]">
              {job.propertyHistory.map((item) => (
                <li key={item.ticketId} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[14px] font-semibold leading-5 text-[#0a0a0a]">
                      {item.workOrderRef}
                    </p>
                    <p className="text-[12px] leading-4 text-[#6a7282]">
                      {formatHistoryDate(item.createdAt)}
                    </p>
                  </div>
                  <p className="mt-0.5 text-[13px] leading-5 text-[#6a7282]">
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

        <section className="rounded-[10px] border border-[#e5e7eb] bg-white p-5 shadow-[0px_1px_2px_-1px_rgba(0,0,0,0.06)]">
          <h2 className="text-[15px] font-semibold leading-5 text-[#0a0a0a]">Next Steps</h2>
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
                className="sa-press inline-flex h-9 items-center justify-center rounded-[10px] border border-[#a7f3d0] bg-[#ecfdf5] px-4 text-[13px] font-medium leading-5 text-[#065f46] hover:bg-[#d1fae5]"
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
                    ? 'sa-press inline-flex h-9 cursor-not-allowed items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-[#f9fafb] px-4 text-[13px] font-medium leading-5 text-[#6a7282]'
                    : 'sa-press inline-flex h-9 items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 text-[13px] font-medium leading-5 text-[#0a0a0a] hover:bg-[#f3f4f6]'
                }
              >
                {startingWork ? 'Starting…' : 'Start work'}
              </button>
            )}
            <ActionLink
              href={job.links.upload}
              label="Upload completion photos & videos"
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
            <p className="mt-2 text-[13px] leading-5 text-[#c10007]">{startWorkError}</p>
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
      ? 'sa-press inline-flex h-9 items-center justify-center rounded-[10px] border border-[#a7f3d0] bg-[#ecfdf5] px-4 text-[13px] font-medium leading-5 text-[#065f46] hover:bg-[#d1fae5]'
      : disabled
        ? 'inline-flex h-9 cursor-not-allowed items-center justify-center rounded-[10px] bg-[#f3f4f6] px-4 text-[13px] font-medium leading-5 text-[#6a7282]'
        : variant === 'secondary'
          ? 'sa-press inline-flex h-9 items-center justify-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 text-[13px] font-medium leading-5 text-[#0a0a0a] hover:bg-[#f3f4f6]'
          : 'sa-press inline-flex h-9 items-center justify-center rounded-[10px] bg-[#186179] px-4 text-[13px] font-medium leading-5 text-white hover:bg-[#145066]'

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
