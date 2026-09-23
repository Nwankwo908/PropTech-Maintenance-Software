import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  formatEstimateDollars,
  humanizeVendorJobDescription,
  PROGRESS_ORDER,
  resolveVendorJobNextStep,
  type VendorJobNextStep,
  type VendorJobNextStepKind,
  type VendorJobProgressMark,
} from '@/lib/vendorJobNextStep'
import {
  formatJobUnitLine,
  jobHeaderBadge,
  jobPageCopy,
  jobPageDateLocale,
  jobStatusLabel,
  persistJobPageLang,
  progressLabel,
  readJobPageLang,
  translateAccessLabel,
  translateTradeLabel,
  withAmount,
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

const CARD = 'rounded-[12px] border border-[#e5e7eb] bg-white p-5'
const SECTION_LABEL =
  'text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6b7280]'
const PRIMARY_BTN =
  'sa-press inline-flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#187960] px-4 text-[16px] font-semibold text-white shadow-sm transition hover:bg-[#146b52] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#187960] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-[#9ca3af] disabled:shadow-none'
const SECONDARY_BTN =
  'sa-press inline-flex h-10 flex-1 items-center justify-center rounded-[8px] border border-[#d1d5db] bg-white px-3 text-[14px] font-semibold text-[#111827] transition hover:bg-[#f9fafb] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#187960]'

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

class JobPageErrorBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  state: { message: string | null } = { message: null }

  static getDerivedStateFromError(error: unknown) {
    return {
      message: getErrorMessage(error, 'Something went wrong opening this job.'),
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

/** Phase 2 / 4.2 — public no-login job detail at `/w/:token`. */
export function WorkOrderPublicPage() {
  return (
    <JobPageErrorBoundary>
      <WorkOrderPublicPageInner />
    </JobPageErrorBoundary>
  )
}

function WorkOrderPublicPageInner() {
  const { token } = useParams<{ token: string }>()
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<ResolveWorkOrderTokenResult | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [lang, setLang] = useState<JobPageLang>(() =>
    typeof window === 'undefined' ? 'en' : readJobPageLang(),
  )
  const copy = jobPageCopy(lang)

  function changeLang(next: JobPageLang) {
    setLang(next)
    persistJobPageLang(next)
  }

  async function loadJob(t: string) {
    const result = await resolveWorkOrderToken(t)
    const sessionToken = result.portalApiKey?.trim() || t
    try {
      localStorage.setItem(VENDOR_TOKEN_STORAGE_KEY, sessionToken)
      window.dispatchEvent(new Event(VENDOR_TOKEN_CHANGED_EVENT))
    } catch {
      /* ignore */
    }
    setData(result)
    return result
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
        const result = await loadJob(t)
        if (cancelled) return
        setData(result)
      } catch (err) {
        if (cancelled) return
        setError(getErrorMessage(err, 'This job link is invalid or has expired.'))
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
            <p className="mt-6 text-[14px] leading-5 text-[#6a7282]">{copy.openFromText}</p>
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
  const humanized = humanizeVendorJobDescription({
    description: job.description,
    issueHeadline: job.issueHeadline,
    entryOkIfAbsent: job.entryOkIfAbsent,
    fallbackTitle: issueLabel,
  })
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

  const locationLines = [
    tenantStreetLine || tenantLocationFallback,
    [unitPart, humanized.affectedArea].filter(Boolean).join(' · ') || null,
    tenantCityLine || null,
  ].filter(Boolean) as string[]

  const nextStep = resolveVendorJobNextStep({
    status: job.status,
    estimateStatus: job.estimateStatus,
    estimateSubmitted: job.estimateSubmitted,
    estimateApproved: job.estimateApproved,
    completionPhotosUploaded: job.completionPhotosUploaded,
    invoiceStatus: job.invoiceStatus,
    invoiceSubmitted: job.invoiceSubmitted,
  })
  const estimateAmount = formatEstimateDollars(job.estimateTotalCost)
  const badge = jobHeaderBadge(job.priority, job.status, copy)
  const accessSummary =
    humanized.accessFromIntake === 'must_be_home'
      ? copy.accessResidentMustBeHome
      : humanized.accessFromIntake === 'ok_if_away'
        ? copy.accessOkIfAway
        : null

  async function runStatusAction(action: 'accept' | 'in_progress') {
    if (actionBusy) return
    const updateUrl = vendorPortalUpdateUrl()
    const vendorToken = portalApiKey?.trim() || token?.trim() || ''
    if (!updateUrl || !vendorToken) {
      setActionError(
        action === 'accept' ? copy.couldNotAcceptJob : copy.couldNotStartWork,
      )
      return
    }
    setActionBusy(true)
    setActionError(null)
    try {
      await updateJobStatus({
        ticketId,
        action,
        updateUrl,
        vendorToken,
      })
      const t = token?.trim() ?? ''
      if (t) await loadJob(t)
    } catch (err) {
      setActionError(
        getErrorMessage(
          err,
          action === 'accept' ? copy.couldNotAcceptJob : copy.couldNotStartWork,
        ),
      )
    } finally {
      setActionBusy(false)
    }
  }

  const nextStepContent = nextStepPresentation(nextStep.kind, copy, estimateAmount, {
    estimateRejected: (job.estimateStatus ?? '').toLowerCase() === 'rejected',
  })

  const primaryAction = resolvePrimaryAction({
    kind: nextStep.kind,
    copy,
    estimateHref: job.links.estimate,
    uploadHref: job.links.upload,
    invoiceHref: job.links.invoice,
    actionBusy,
    estimateRejected: (job.estimateStatus ?? '').toLowerCase() === 'rejected',
    onAccept: () => void runStatusAction('accept'),
    onStartWork: () => void runStatusAction('in_progress'),
  })

  const stickyCta = primaryAction
  const hasSticky = Boolean(stickyCta)

  return (
    <div
      className={`min-h-dvh bg-[#f9fafb] font-[family-name:var(--font-admin)] text-[#111827] ${hasSticky ? 'pb-24 lg:pb-12' : 'pb-12'}`}
      lang={lang}
    >
      <div className="mx-auto w-full max-w-[1120px]">
        <header className="flex items-center justify-between gap-3 px-4 py-4 lg:px-8">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[12px] font-medium text-[#6b7280]">{copy.jobDetail}</p>
            <p className="text-[13px] font-semibold text-[#9ca3af]">{workOrderRef}</p>
          </div>
          <LanguageSelect lang={lang} copy={copy} onChange={changeLang} />
        </header>

        <main className="flex flex-col gap-5 px-4 lg:flex-row lg:items-start lg:gap-8 lg:px-8">
          {/* LEFT — job information */}
          <div className="flex min-w-0 w-full flex-col gap-5 lg:max-w-[640px] lg:flex-1">
            <section className="flex flex-col gap-2">
              {badge.emergency ? (
                <span
                  className={`inline-flex w-fit items-center rounded-[6px] px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.04em] ${badge.className}`}
                >
                  {badge.label}
                </span>
              ) : null}
              <h1 className="text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-[#111827] lg:text-[32px]">
                {humanized.title}
              </h1>
              {locationLines.length > 0 ? (
                <div className="flex flex-col gap-0.5 text-[15px] leading-snug text-[#4b5563]">
                  {locationLines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              ) : null}
              {!badge.emergency ? (
                <span
                  className={`mt-1 inline-flex w-fit items-center rounded-[6px] px-2.5 py-1 text-[12px] font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>
              ) : null}
            </section>

            {/* Mobile: next step high on page */}
            <div className="lg:hidden">
              <NextStepCard
                copy={copy}
                nextStep={nextStep}
                content={nextStepContent}
                primaryAction={primaryAction}
                actionError={actionError}
                hidePrimaryInCard={hasSticky}
                onRetry={() => {
                  if (nextStep.kind === 'accept') void runStatusAction('accept')
                  else if (nextStep.kind === 'start_work') void runStatusAction('in_progress')
                }}
              />
            </div>

            {job.photoUrls.length > 0 ? (
              <a
                href={job.photoUrls[0]}
                target="_blank"
                rel="noreferrer"
                className="relative block aspect-[4/3] w-full overflow-hidden rounded-[12px] bg-[#f3f4f6] lg:aspect-[16/10]"
              >
                <img
                  src={job.photoUrls[0]}
                  alt={copy.tenantPhotoAlt}
                  className="absolute inset-0 size-full object-cover"
                />
              </a>
            ) : null}

            {job.photoUrls.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {job.photoUrls.slice(1).map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="relative block size-[72px] shrink-0 overflow-hidden rounded-[8px] bg-[#f3f4f6]"
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

            <section className={`${CARD} flex flex-col gap-3`}>
              <h2 className={SECTION_LABEL}>{copy.jobDetails}</h2>
              {humanized.residentReport ? (
                <div>
                  <p className="text-[12px] font-medium text-[#6b7280]">{copy.residentReported}</p>
                  <p className="mt-1 text-[16px] leading-relaxed text-[#111827]">
                    “{humanized.residentReport}”
                  </p>
                </div>
              ) : (
                <p className="text-[14px] text-[#6b7280]">{copy.noDescription}</p>
              )}
              {humanized.affectedArea ? (
                <p className="text-[14px] text-[#4b5563]">
                  <span className="font-medium text-[#111827]">{humanized.affectedArea}</span>
                </p>
              ) : null}
            </section>

            <section className={`${CARD} flex flex-col gap-3`}>
              <h2 className={SECTION_LABEL}>{copy.propertyAccess}</h2>
              {accessSummary ? (
                <p className="text-[15px] font-medium leading-snug text-[#111827]">
                  {accessSummary}
                </p>
              ) : null}
              {accessRows.length > 0 ? (
                <dl className="space-y-3">
                  {accessRows.map((row) => (
                    <div key={row.label}>
                      <dt className="text-[12px] leading-4 text-[#6b7280]">{row.label}</dt>
                      <dd className="mt-0.5 text-[14px] font-medium leading-5 text-[#333]">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : !accessSummary ? (
                <p className="whitespace-pre-wrap text-[14px] text-[#6b7280]">
                  {ticketAccessNotes || copy.noAccessNotes}
                </p>
              ) : null}
              {accessRows.length > 0 && ticketAccessNotes ? (
                <div className="border-t border-[#f3f4f6] pt-3">
                  <p className="text-[12px] text-[#6b7280]">{copy.jobSpecificNotes}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] text-[#333]">
                    {ticketAccessNotes}
                  </p>
                </div>
              ) : null}
            </section>

            <section className={`${CARD} flex flex-col gap-3`}>
              <h2 className={SECTION_LABEL}>{copy.resident}</h2>
              <p className="text-[16px] font-semibold text-[#111827]">{job.tenant.name}</p>
              {job.tenant.phone ? (
                <div className="flex gap-2">
                  <a href={`tel:${job.tenant.phone}`} className={SECONDARY_BTN}>
                    {copy.call}
                  </a>
                  <a href={`sms:${job.tenant.phone}`} className={SECONDARY_BTN}>
                    {copy.textSms}
                  </a>
                </div>
              ) : (
                <p className="text-[14px] text-[#6b7280]">{copy.noPhone}</p>
              )}
            </section>

            <section className={`${CARD} flex flex-col gap-2`}>
              <h2 className={SECTION_LABEL}>{copy.appointment}</h2>
              <p className="text-[15px] font-semibold text-[#111827]">{appointmentText}</p>
              {job.vendorName ? (
                <p className="text-[13px] text-[#6b7280]">
                  {copy.vendorPrefix} {job.vendorName}
                </p>
              ) : null}
            </section>

            <section className={`${CARD} flex flex-col gap-3`}>
              <h2 className={SECTION_LABEL}>{copy.jobHistory}</h2>
              {job.propertyHistory.length === 0 ? (
                <p className="text-[14px] text-[#6b7280]">{copy.noPreviousJobs}</p>
              ) : (
                <ul className="divide-y divide-[#f3f4f6]">
                  {job.propertyHistory.map((item) => (
                    <li key={item.ticketId} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-[14px] font-semibold text-[#333]">{item.workOrderRef}</p>
                        <p className="text-[12px] text-[#6b7280]">
                          {formatHistoryDate(item.createdAt, lang)}
                        </p>
                      </div>
                      <p className="mt-0.5 text-[13px] text-[#6b7280]">
                        {item.unit || copy.unitFallback} · {jobStatusLabel(item.status, copy)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* RIGHT — action / workflow (desktop) */}
          <aside className="hidden w-full shrink-0 lg:sticky lg:top-4 lg:block lg:w-[360px]">
            <NextStepCard
              copy={copy}
              nextStep={nextStep}
              content={nextStepContent}
              primaryAction={primaryAction}
              actionError={actionError}
              hidePrimaryInCard={false}
              onRetry={() => {
                if (nextStep.kind === 'accept') void runStatusAction('accept')
                else if (nextStep.kind === 'start_work') void runStatusAction('in_progress')
              }}
            />
          </aside>
        </main>
      </div>

      {stickyCta && hasSticky ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#e5e7eb] bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <PrimaryActionControl action={stickyCta} />
        </div>
      ) : null}
    </div>
  )
}

type NextStepContent = { title: string; body: string }

function nextStepPresentation(
  kind: VendorJobNextStepKind,
  copy: JobPageCopyBundle,
  amount: string | null,
  opts: { estimateRejected: boolean },
): NextStepContent {
  switch (kind) {
    case 'accept':
      return { title: copy.acceptTitle, body: copy.acceptBody }
    case 'submit_estimate':
      return opts.estimateRejected
        ? { title: copy.resubmitEstimate, body: copy.resubmitEstimateBody }
        : { title: copy.submitEstimateTitle, body: copy.submitEstimateBody }
    case 'waiting_estimate_approval':
      return {
        title: copy.waitingApprovalTitle,
        body: amount
          ? withAmount(copy.waitingApprovalBodyWithAmount, amount)
          : copy.waitingApprovalBody,
      }
    case 'start_work':
      return {
        title: copy.readyToStartTitle,
        body: amount
          ? withAmount(copy.readyToStartBodyWithAmount, amount)
          : copy.readyToStartBody,
      }
    case 'add_photos':
      return { title: copy.addPhotosTitle, body: copy.addPhotosBody }
    case 'submit_invoice':
      return { title: copy.submitInvoiceTitle, body: copy.submitInvoiceBody }
    case 'waiting_payment':
      return { title: copy.waitingPaymentTitle, body: copy.waitingPaymentBody }
    case 'job_complete':
      return { title: copy.jobCompleteTitle, body: copy.jobCompleteBody }
    case 'declined':
      return { title: copy.declinedTitle, body: copy.declinedBody }
  }
}

type PrimaryAction =
  | { type: 'button'; label: string; busyLabel: string; busy: boolean; onClick: () => void }
  | { type: 'link'; label: string; href: string }

function resolvePrimaryAction(input: {
  kind: VendorJobNextStepKind
  copy: JobPageCopyBundle
  estimateHref: string
  uploadHref: string
  invoiceHref: string
  actionBusy: boolean
  estimateRejected: boolean
  onAccept: () => void
  onStartWork: () => void
}): PrimaryAction | null {
  switch (input.kind) {
    case 'accept':
      return {
        type: 'button',
        label: input.copy.acceptJob,
        busyLabel: input.copy.accepting,
        busy: input.actionBusy,
        onClick: input.onAccept,
      }
    case 'submit_estimate':
      return {
        type: 'link',
        label: input.estimateRejected
          ? input.copy.resubmitEstimate
          : input.copy.submitEstimate,
        href: input.estimateHref,
      }
    case 'start_work':
      return {
        type: 'button',
        label: input.copy.startWork,
        busyLabel: input.copy.starting,
        busy: input.actionBusy,
        onClick: input.onStartWork,
      }
    case 'add_photos':
      return { type: 'link', label: input.copy.addPhotosCta, href: input.uploadHref }
    case 'submit_invoice':
      return { type: 'link', label: input.copy.submitInvoice, href: input.invoiceHref }
    default:
      return null
  }
}

function PrimaryActionControl({
  action,
  trailingArrow = true,
}: {
  action: PrimaryAction
  trailingArrow?: boolean
}) {
  const label =
    action.type === 'button'
      ? action.busy
        ? action.busyLabel
        : trailingArrow
          ? `${action.label} →`
          : action.label
      : trailingArrow
        ? `${action.label} →`
        : action.label

  if (action.type === 'button') {
    return (
      <button
        type="button"
        onClick={action.onClick}
        disabled={action.busy}
        className={PRIMARY_BTN}
      >
        {label}
      </button>
    )
  }

  return <SmartLink href={action.href} className={PRIMARY_BTN} label={label} />
}

function NextStepCard({
  copy,
  nextStep,
  content,
  primaryAction,
  actionError,
  hidePrimaryInCard,
  onRetry,
}: {
  copy: JobPageCopyBundle
  nextStep: VendorJobNextStep
  content: NextStepContent
  primaryAction: PrimaryAction | null
  actionError: string | null
  hidePrimaryInCard: boolean
  onRetry: () => void
}) {
  return (
    <section className={`${CARD} flex flex-col gap-5 shadow-sm`}>
      <div>
        <p className={SECTION_LABEL}>{copy.yourNextStep}</p>
        <h2 className="mt-2 text-[22px] font-bold leading-tight text-[#111827]">
          {content.title}
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-[#4b5563]">{content.body}</p>
      </div>

      {primaryAction && !hidePrimaryInCard ? (
        <PrimaryActionControl action={primaryAction} />
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-3 py-3"
        >
          <p className="text-[13px] font-semibold text-[#991b1b]">{copy.actionFailedTitle}</p>
          <p className="mt-1 text-[13px] text-[#b91c1c]">{actionError}</p>
          {primaryAction?.type === 'button' ? (
            <button
              type="button"
              onClick={onRetry}
              className="sa-press mt-3 inline-flex h-9 items-center rounded-[6px] border border-[#fca5a5] bg-white px-3 text-[13px] font-semibold text-[#991b1b] hover:bg-[#fff5f5]"
            >
              {copy.retry}
            </button>
          ) : null}
        </div>
      ) : null}

      {nextStep.comingNext.length > 0 ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9ca3af]">
            {copy.comingNext}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {nextStep.comingNext.map((id) => (
              <li
                key={id}
                className="flex items-center gap-2 text-[13px] text-[#9ca3af]"
              >
                <span aria-hidden className="text-[10px]">
                  ○
                </span>
                {progressLabel(id, copy)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="border-t border-[#f3f4f6] pt-4">
        <p className={SECTION_LABEL}>{copy.jobProgress}</p>
        <ol className="mt-3 flex flex-col gap-2.5">
          {PROGRESS_ORDER.map((id) => (
            <ProgressRow
              key={id}
              mark={nextStep.progress[id]}
              label={progressLabel(id, copy)}
            />
          ))}
        </ol>
      </div>
    </section>
  )
}

function ProgressRow({
  mark,
  label,
}: {
  mark: VendorJobProgressMark
  label: string
}) {
  if (mark === 'done') {
    return (
      <li className="flex items-center gap-2.5 text-[14px] text-[#6b7280]">
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#e8f5f0] text-[11px] font-bold text-[#187960]"
          aria-hidden
        >
          ✓
        </span>
        <span>{label}</span>
      </li>
    )
  }
  if (mark === 'current') {
    return (
      <li className="flex items-center gap-2.5 text-[14px] font-semibold text-[#111827]">
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#187960] text-[10px] text-white"
          aria-hidden
        >
          ●
        </span>
        <span>{label}</span>
      </li>
    )
  }
  return (
    <li className="flex items-center gap-2.5 text-[14px] text-[#9ca3af]">
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded-full border border-[#d1d5db] text-[10px] text-[#d1d5db]"
        aria-hidden
      >
        ○
      </span>
      <span>{label}</span>
    </li>
  )
}

function SmartLink({
  href,
  className,
  label,
}: {
  href: string
  className: string
  label: string
}) {
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
