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
import {
  formatJobUnitLine,
  jobHeaderBadge,
  jobPageCopy,
  jobPageDateLocale,
  jobStatusLabel,
  persistJobPageLang,
  readJobPageLang,
  translateAccessLabel,
  translateTradeLabel,
  type JobPageCopyBundle,
  type JobPageLang,
} from '@/lib/workOrderPublicPageCopy'

function formatWhen(
  iso: string | null,
  windowText: string | null,
  lang: JobPageLang,
  notScheduled: string,
): string {
  if (windowText?.trim()) return windowText.trim()
  if (!iso) return notScheduled
  try {
    return new Date(iso).toLocaleString(jobPageDateLocale(lang), {
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

const CARD =
  'rounded-[12px] border border-[#e5e7eb] bg-white p-5'
const CARD_TITLE = 'text-[16px] font-semibold leading-normal text-[#121212]'
const BTN =
  'sa-press inline-flex h-11 w-full items-center justify-center rounded-[8px] px-4 text-[15px] font-semibold'

function formatHistoryDate(iso: string, lang: JobPageLang): string {
  try {
    return new Date(iso).toLocaleDateString(jobPageDateLocale(lang), {
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
  const [lang, setLang] = useState<JobPageLang>(() =>
    typeof window === 'undefined' ? 'en' : readJobPageLang(),
  )
  const copy = jobPageCopy(lang)

  function changeLang(next: JobPageLang) {
    setLang(next)
    persistJobPageLang(next)
  }

  useEffect(() => {
    let cancelled = false
    const t = token?.trim() ?? ''
    if (!t) {
      setError('missing_token')
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
            {copy.couldntOpen}
          </h1>
          <p className="mt-2 text-[14px] leading-5 text-[#6a7282]">
            {error === 'missing_token' ? copy.missingToken : error}
          </p>
          {token?.trim() ? (
            <Link
              to={`/w/${encodeURIComponent(token.trim())}`}
              className="sa-link mt-6 inline-flex text-[14px] font-medium text-[#186179]"
            >
              {copy.tryAgain}
            </Link>
          ) : (
            <p className="mt-6 text-[14px] leading-5 text-[#6a7282]">
              {copy.openFromText}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f9fafb] px-4 font-[family-name:var(--font-admin)]">
        <p className="text-[14px] text-[#6a7282]">{copy.loading}</p>
      </div>
    )
  }

  const { job, workOrderRef, ticketId, portalApiKey } = data
  const issueLabel = job.issueCategory
    ? translateTradeLabel(formatVendorTradeLabel(job.issueCategory), lang)
    : copy.maintenance
  const accessRows = job.propertyAccess
    ? propertyAccessDisplayRows(normalizePropertyAccess(job.propertyAccess)).map((row) => ({
        ...row,
        label: translateAccessLabel(row.label, lang),
      }))
    : []
  const ticketAccessNotes = job.accessInstructions?.trim() || ''
  const appointmentText = formatWhen(
    job.appointment.scheduledAt,
    job.appointment.windowText,
    lang,
    copy.notScheduled,
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
      ? /^unit\b/i.test(unitRaw) || /^unidad\b/i.test(unitRaw)
        ? unitRaw
        : formatJobUnitLine(unitRaw, lang)
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
      setStartWorkError(copy.couldNotStartWork)
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
        getErrorMessage(err, copy.couldNotStartWork),
      )
      setStartingWork(false)
    }
  }

  const badge = jobHeaderBadge(job.priority, job.status, copy)

  const nextStepsProps = {
    copy,
    estimateHref: job.links.estimate,
    estimateSubmitted: job.estimateSubmitted,
    workStarted,
    ticketId,
    canStartWork,
    startingWork,
    onStartWork: () => void handleStartWork(),
    uploadHref: job.links.upload,
    invoiceHref: job.links.invoice,
    estimateApproved: job.estimateApproved,
    completionPhotosUploaded: job.completionPhotosUploaded,
    startWorkError,
  }

  return (
    <div
      className="min-h-dvh bg-[#f9fafb] font-[family-name:var(--font-admin)] text-[#111827]"
      lang={lang}
    >
      <div className="mx-auto w-full max-w-[1360px] pb-12">
        <header className="flex items-center justify-between gap-3 px-4 py-4 lg:px-24">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[12px] font-medium leading-normal text-[#4b5563]">{copy.jobDetail}</p>
            <h1 className="text-[28px] font-extrabold leading-normal text-[#111827]">{workOrderRef}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <LanguageSelect lang={lang} copy={copy} onChange={changeLang} />
            <span
              className={`inline-flex shrink-0 items-center justify-center rounded-[6px] px-3 py-1.5 text-[13px] font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>
        </header>

        <main className="flex flex-col gap-4 px-4 lg:flex-row lg:items-start lg:px-24">
          <div className="flex min-w-0 w-full flex-col gap-4 lg:max-w-[950px] lg:flex-1">
            <section className={`${CARD} flex flex-col gap-3`}>
              <h2 className={CARD_TITLE}>{copy.description}</h2>
              <p className="text-[13px] font-normal leading-normal text-[#666]">{issueLabel}</p>
              {descriptionBlocks.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {descriptionBlocks.map((paragraph, index) => (
                    <li
                      key={`${index}-${paragraph.slice(0, 24)}`}
                      className="flex items-start gap-2 text-[14px] leading-normal"
                    >
                      <span className="shrink-0 text-[#666]" aria-hidden>
                        •
                      </span>
                      <span className="min-w-0 text-[#333]">{paragraph}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[14px] leading-normal text-[#666]">{copy.noDescription}</p>
              )}
              {job.photoUrls.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {job.photoUrls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="relative block size-[120px] shrink-0 overflow-hidden rounded-[8px] bg-[#f3f4f6]"
                    >
                      <img
                        src={url}
                        alt={copy.tenantPhotoAlt}
                        className="absolute inset-0 size-full object-cover"
                      />
                    </a>
                  ))}
                </div>
              ) : null}
            </section>

            <section className={`${CARD} flex flex-col gap-3`}>
              <h2 className={CARD_TITLE}>{copy.propertyAccess}</h2>
              {accessRows.length > 0 ? (
                <dl className="space-y-3">
                  {accessRows.map((row) => (
                    <div key={row.label}>
                      <dt className="text-[12px] leading-4 text-[#666]">{row.label}</dt>
                      <dd className="mt-0.5 text-[14px] font-medium leading-5 text-[#333]">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="whitespace-pre-wrap text-[14px] font-normal leading-normal text-[#666]">
                  {ticketAccessNotes || copy.noAccessNotes}
                </p>
              )}
              {accessRows.length > 0 && ticketAccessNotes ? (
                <div className="border-t border-[#f3f4f6] pt-3">
                  <p className="text-[12px] leading-4 text-[#666]">{copy.jobSpecificNotes}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-normal text-[#333]">
                    {ticketAccessNotes}
                  </p>
                </div>
              ) : null}
            </section>

            <section className={`${CARD} flex flex-col gap-3`}>
              <h2 className={CARD_TITLE}>{copy.tenantContact}</h2>
              <div className="flex flex-col gap-1 text-[14px] leading-normal">
                <p className="font-semibold text-[#333]">{job.tenant.name}</p>
                {tenantUnitLine ? <p className="font-normal text-[#333]">{tenantUnitLine}</p> : null}
                {tenantStreetLine ? (
                  <p className="font-normal text-[#333]">{tenantStreetLine}</p>
                ) : null}
                {tenantCityLine ? <p className="font-normal text-[#333]">{tenantCityLine}</p> : null}
                {tenantLocationFallback ? (
                  <p className="font-normal text-[#333]">{tenantLocationFallback}</p>
                ) : null}
                {job.tenant.phone ? (
                  <a href={`tel:${job.tenant.phone}`} className="font-normal text-[#1a5f7a] hover:underline">
                    {job.tenant.phone}
                  </a>
                ) : (
                  <p className="text-[#666]">{copy.noPhone}</p>
                )}
              </div>
            </section>

            <section className={`${CARD} flex flex-col gap-3`}>
              <h2 className={CARD_TITLE}>{copy.appointment}</h2>
              <div className="flex flex-col gap-1 text-[14px] leading-normal text-[#333]">
                <p className="font-semibold">{appointmentText}</p>
                {job.vendorName ? (
                  <p className="font-normal">
                    {copy.vendorPrefix} {job.vendorName}
                  </p>
                ) : null}
              </div>
            </section>

            <section className={`${CARD} flex flex-col gap-3`}>
              <h2 className={CARD_TITLE}>{copy.jobHistory}</h2>
              {job.propertyHistory.length === 0 ? (
                <p className="text-[14px] font-normal leading-normal text-[#666]">
                  {copy.noPreviousJobs}
                </p>
              ) : (
                <ul className="divide-y divide-[#f3f4f6]">
                  {job.propertyHistory.map((item) => (
                    <li key={item.ticketId} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[14px] font-semibold text-[#333]">{item.workOrderRef}</p>
                        <p className="text-[12px] text-[#666]">{formatHistoryDate(item.createdAt, lang)}</p>
                      </div>
                      <p className="mt-0.5 text-[13px] text-[#666]">
                        {item.unit || copy.unitFallback} · {jobStatusLabel(item.status, copy)}
                      </p>
                      {item.description ? (
                        <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-[#333]">
                          {item.description}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="lg:hidden">
              <NextStepsCard {...nextStepsProps} />
            </div>
          </div>

          <aside className="hidden w-full shrink-0 lg:sticky lg:top-4 lg:block lg:w-[340px]">
            <NextStepsCard {...nextStepsProps} />
          </aside>
        </main>
      </div>
    </div>
  )
}

function LanguageSelect({
  lang,
  copy,
  onChange,
}: {
  lang: JobPageLang
  copy: JobPageCopyBundle
  onChange: (lang: JobPageLang) => void
}) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{copy.language}</span>
      <select
        value={lang}
        onChange={(event) => onChange(event.target.value === 'es' ? 'es' : 'en')}
        className="h-[34px] max-w-[11rem] cursor-pointer appearance-none rounded-[6px] border border-[#e5e7eb] bg-white py-0 pl-2 pr-7 text-[13px] font-medium text-[#111827] outline-none focus:border-[#187960] focus:ring-2 focus:ring-[#187960]/20"
      >
        <option value="en">🇺🇸 {copy.english}</option>
        <option value="es">🇪🇸 {copy.spanish}</option>
      </select>
      <span
        className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-[4px] text-[#111827]"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-4">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </label>
  )
}

function NextStepsCard({
  copy,
  estimateHref,
  estimateSubmitted,
  workStarted,
  ticketId,
  canStartWork,
  startingWork,
  onStartWork,
  uploadHref,
  invoiceHref,
  estimateApproved,
  completionPhotosUploaded,
  startWorkError,
}: {
  copy: JobPageCopyBundle
  estimateHref: string
  estimateSubmitted: boolean
  workStarted: boolean
  ticketId: string
  canStartWork: boolean
  startingWork: boolean
  onStartWork: () => void
  uploadHref: string
  invoiceHref: string
  estimateApproved: boolean
  completionPhotosUploaded: boolean
  startWorkError: string | null
}) {
  return (
    <section className={`${CARD} flex flex-col gap-6`}>
      <h2 className={CARD_TITLE}>{copy.nextSteps}</h2>
      <div className="flex w-full flex-col gap-3">
        <ActionLink
          href={estimateHref}
          label={estimateSubmitted ? copy.estimateSubmitted : copy.submitEstimate}
          variant={estimateSubmitted ? 'submitted' : 'primary'}
        />
        {workStarted ? (
          <Link
            to={`/vendor/ticket/${encodeURIComponent(ticketId)}`}
            title={copy.workStartedTitle}
            className={`${BTN} border border-[rgba(24,97,121,0.57)] bg-white text-[#1a1a1a] hover:bg-[#f9fafb]`}
          >
            {copy.workStarted}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onStartWork}
            disabled={!canStartWork || startingWork}
            title={canStartWork ? copy.startWorkTitle : copy.startWorkLockedTitle}
            className={
              !canStartWork || startingWork
                ? `${BTN} cursor-not-allowed bg-[#f3f4f6] text-[#333]`
                : `${BTN} border border-[rgba(24,97,121,0.57)] bg-white text-[#1a1a1a] hover:bg-[#f9fafb]`
            }
          >
            {startingWork ? copy.starting : copy.startWork}
          </button>
        )}
        <UploadPhotosAction
          href={uploadHref}
          label={copy.uploadPhotos}
          disabled={!estimateApproved}
          disabledHint={copy.afterEstimateApproved}
        />
        <ActionLink
          href={invoiceHref}
          label={copy.submitInvoice}
          disabled={!estimateApproved || !completionPhotosUploaded}
          disabledHint={
            !estimateApproved ? copy.afterEstimateApproved : copy.afterUploadPhotos
          }
        />
      </div>
      {startWorkError ? (
        <p className="text-[13px] leading-5 text-[#c10007]">{startWorkError}</p>
      ) : null}
    </section>
  )
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className="size-5 shrink-0"
      aria-hidden
    >
      <path
        d="M10 4v12M4 10h12"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}

function UploadPhotosAction({
  href,
  label,
  disabled = false,
  disabledHint,
}: {
  href: string
  label: string
  disabled?: boolean
  disabledHint?: string
}) {
  const className = disabled
    ? 'inline-flex min-h-[72px] w-full cursor-not-allowed flex-col items-center justify-center gap-2 rounded-[8px] border-2 border-dashed border-[#d1d5dc] bg-[#f9fafb] px-4 py-4 text-[15px] font-semibold text-[#9ca3af]'
    : 'sa-press inline-flex min-h-[72px] w-full flex-col items-center justify-center gap-2 rounded-[8px] border-2 border-dashed border-[#d1d5dc] bg-white px-4 py-4 text-[15px] font-semibold text-[#333] hover:border-[#187960]/55 hover:bg-[#f8faf9]'

  const inner = (
    <>
      <PlusIcon />
      <span>{label}</span>
    </>
  )

  if (disabled) {
    return (
      <button
        type="button"
        disabled
        title={disabledHint}
        aria-disabled="true"
        className={className}
      >
        {inner}
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
            {inner}
          </Link>
        )
      }
    } catch {
      /* fall through */
    }
    return (
      <a href={href} className={className}>
        {inner}
      </a>
    )
  }

  return (
    <Link to={href} className={className}>
      {inner}
    </Link>
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
      ? `${BTN} bg-[#187960] text-white opacity-90`
      : disabled
        ? `${BTN} cursor-not-allowed bg-[#f3f4f6] text-[#333]`
        : variant === 'secondary'
          ? `${BTN} border border-[rgba(24,97,121,0.57)] bg-white text-[#1a1a1a] hover:bg-[#f9fafb]`
          : `${BTN} bg-[#187960] text-white hover:bg-[#146b52]`

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
