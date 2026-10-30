import { useEffect, useId, useState } from 'react'
import { homeCheckRequest, requestPlatformHomeCheck, type HomeCheckList, type HomeCheckOptions, type HomeCheckVendor } from '@/api/homeCheck'
import { loadActiveHomeCheckVendors } from '@/lib/homeCheckActiveVendor'
import { notifyHomeCheckChanged } from '@/lib/homeCheckEvents'
import { chooseHomeCheckContractorId } from '@shared/homeCheck'
import { homeCheckVendorAcceptanceSms } from '@shared/homeCheckVisit'

const SETUP_VENDOR_MESSAGE = 'Go and set up your vendor first.'
const SENT_MESSAGE = 'Message was sent successfully.'
const STATE_MISMATCH_MESSAGE = 'No contractor in this property’s state can take this home check.'

export function latestCompletedHomeCheckSentAt(
  checks: ReadonlyArray<{
    status?: string | null
    completed_at?: string | null
    sent_at?: string | null
    created_at?: string | null
  }>,
): string | null {
  const completed = checks.filter((check) => check.status === 'completed' || Boolean(check.completed_at))
  const latest = completed.slice().sort((a, b) => {
    const left = Date.parse(a.sent_at || a.created_at || a.completed_at || '')
    const right = Date.parse(b.sent_at || b.created_at || b.completed_at || '')
    return (Number.isFinite(right) ? right : 0) - (Number.isFinite(left) ? left : 0)
  })[0]
  if (!latest) return null
  return latest.sent_at || latest.created_at || latest.completed_at || null
}

export function homeCheckResendPrompt(sentAt: string): string {
  const date = new Date(sentAt)
  const label = Number.isFinite(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'an earlier date'
  return `This was sent out ${label}. Are you sure you want to send again?`
}

export function homeCheckRequestSelection(options: HomeCheckOptions): {
  vendor: HomeCheckVendor | null
  error: string | null
} {
  const selectedId = options.closest || chooseHomeCheckContractorId(
    { latitude: null, longitude: null, state: options.propertyState ?? null },
    options.vendors.map((vendor) => ({
      id: vendor.id,
      latitude: vendor.latitude ?? null,
      longitude: vendor.longitude ?? null,
      states: vendor.states ?? [],
      preferred: vendor.preferred_emergency === true || vendor.preferred === true,
    })),
  )
  const vendor = options.vendors.find((row) => row.id === selectedId) ?? null
  if (!vendor && options.vendors.length) return { vendor: null, error: STATE_MISMATCH_MESSAGE }
  return { vendor, error: null }
}

export function HomeCheckRequestDialog({
  titleId,
  location,
  loading,
  submitting,
  vendor,
  sent,
  error,
  repeatPrompt,
  onConfirm,
  onDismiss,
}: {
  titleId: string
  location: string
  loading: boolean
  submitting: boolean
  vendor: boolean
  sent: boolean
  error: string | null
  repeatPrompt?: string | null
  onConfirm: () => void
  onDismiss: () => void
}) {
  const askingAgain = Boolean(repeatPrompt)
  const needsVendor = !loading && !sent && !vendor && !error && !askingAgain
  const preview = homeCheckVendorAcceptanceSms(location.trim() || 'this property')
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div
        role="presentation"
        className="absolute inset-0"
        aria-hidden
        onClick={onDismiss}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[420px] rounded-[12px] bg-white p-6 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)]"
      >
        <h2 id={titleId} className="text-[18px] font-semibold leading-6 text-[#111827]">
          Request home check
        </h2>
        {askingAgain ? (
          <p className="mt-3 text-[14px] leading-5 text-[#111827]">{repeatPrompt}</p>
        ) : loading ? (
          <p className="mt-3 text-[14px] leading-5 text-[#4b5563]">Finding an available vendor for this property.</p>
        ) : sent ? (
          <p className="mt-3 text-[14px] leading-5 text-[#111827]">{SENT_MESSAGE}</p>
        ) : vendor ? (
          <>
            <p className="mt-3 text-[14px] leading-5 text-[#111827]">
              A message will be sent to your available vendor to complete your home health check.
            </p>
            <p className="mt-4 text-[13px] font-medium leading-5 text-[#374151]">Message preview</p>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-[8px] bg-[#f3f4f6] p-3 font-sans text-[13px] leading-5 text-[#111827]">
              {preview}
            </pre>
          </>
        ) : (
          <p className="mt-3 text-[14px] leading-5 text-[#111827]">
            {needsVendor ? SETUP_VENDOR_MESSAGE : error}
          </p>
        )}
        {vendor && error ? <p className="mt-3 text-[13px] leading-5 text-[#b91c1c]">{error}</p> : null}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          {(askingAgain || (vendor && !sent)) ? (
            <button
              type="button"
              disabled={submitting}
              onClick={onDismiss}
              className="pd-btn pd-btn-ghost rounded-[10px] px-4 py-2.5 text-[13px] font-semibold"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={loading || submitting}
            onClick={() => {
              if (askingAgain || (vendor && !sent)) onConfirm()
              else onDismiss()
            }}
            className="pd-btn pd-btn-primary rounded-[10px] px-4 py-2.5 text-[13px] font-semibold disabled:opacity-60"
          >
            {submitting ? 'Sending…' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}

type HomeCheckRequestModalProps = {
  open: boolean
  propertyId: string
  location: string
  onClose: () => void
  onRequested: (message: string) => void
}

export function HomeCheckRequestModal({
  open,
  propertyId,
  location,
  onClose,
  onRequested,
}: HomeCheckRequestModalProps) {
  const titleId = useId()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [vendor, setVendor] = useState<HomeCheckVendor | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [repeatPrompt, setRepeatPrompt] = useState<string | null>(null)
  const [historyReady, setHistoryReady] = useState(false)

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, submitting])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setVendor(null)
    setError(null)
    setSent(false)
    setRepeatPrompt(null)
    setHistoryReady(false)
    void homeCheckRequest<HomeCheckList>({ action: 'list', propertyId })
      .then((list) => {
        if (cancelled) return
        const sentAt = latestCompletedHomeCheckSentAt(list.checks)
        setRepeatPrompt(sentAt ? homeCheckResendPrompt(sentAt) : null)
      })
      .catch(() => {
        if (!cancelled) setRepeatPrompt(null)
      })
      .finally(() => {
        if (!cancelled) setHistoryReady(true)
      })
    void homeCheckRequest<HomeCheckOptions>({
      action: 'options',
      propertyId,
    })
      .then(async (options) => {
        if (cancelled) return
        const vendors = await loadActiveHomeCheckVendors(options.vendors)
        if (cancelled) return
        const closest = vendors.some((row) => row.id === options.closest) ? options.closest : null
        const selection = homeCheckRequestSelection({ ...options, vendors, closest })
        setVendor(selection.vendor)
        setError(selection.error)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not find a contractor.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, propertyId])

  if (!open) return null

  async function onConfirm() {
    if (repeatPrompt) {
      setRepeatPrompt(null)
      return
    }
    if (!vendor || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await requestPlatformHomeCheck({
        propertyId,
        vendorId: vendor.id,
      })
      notifyHomeCheckChanged(propertyId)
      if (result.deliveryError) {
        setError(
          `The text to ${result.vendorName} did not go through. The home check is on Active Tasks.`,
        )
        setSubmitting(false)
        return
      }
      setSent(true)
      setSubmitting(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not request this home check.'
      if (message === SETUP_VENDOR_MESSAGE) {
        setVendor(null)
        setError(null)
      } else {
        setError(message)
      }
      setSubmitting(false)
    }
  }

  function dismiss() {
    if (submitting) return
    if (sent) onRequested(SENT_MESSAGE)
    onClose()
  }

  return (
    <HomeCheckRequestDialog
      titleId={titleId}
      location={location}
      loading={loading || !historyReady}
      submitting={submitting}
      vendor={Boolean(vendor)}
      sent={sent}
      error={error}
      repeatPrompt={repeatPrompt}
      onConfirm={() => {
        void onConfirm()
      }}
      onDismiss={dismiss}
    />
  )
}