import { useEffect, useId, useState } from 'react'
import { homeCheckRequest, requestPlatformHomeCheck, type HomeCheckOptions, type HomeCheckVendor } from '@/api/homeCheck'
import { notifyHomeCheckChanged } from '@/lib/homeCheckEvents'
import { chooseHomeCheckContractorId, homeCheckRequestVendorCopy } from '@shared/homeCheck'

type HomeCheckRequestModalProps = {
  open: boolean
  propertyId: string
  onClose: () => void
  onRequested: (message: string) => void
}

export function HomeCheckRequestModal({
  open,
  propertyId,
  onClose,
  onRequested,
}: HomeCheckRequestModalProps) {
  const titleId = useId()
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [vendor, setVendor] = useState<HomeCheckVendor | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    void homeCheckRequest<HomeCheckOptions>({
      action: 'options',
      propertyId,
    })
      .then((options) => {
        if (cancelled) return
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
        const selected = options.vendors.find((row) => row.id === selectedId) ?? null
        setVendor(selected)
        if (!selected) {
          setError(
            options.vendors.length
              ? 'No contractor in this property’s state can take this home check.'
              : 'No active contractor with a phone number can take this home check.',
          )
        }
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

  const vendorName = vendor ? vendor.name?.trim() || 'Contractor' : ''

  async function onContinue() {
    if (!vendor || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await requestPlatformHomeCheck({
        propertyId,
        vendorId: vendor.id,
      })
      notifyHomeCheckChanged(propertyId)
      const sent = result.deliveryError
        ? `Home check requested. It is on Active Tasks. The text to ${result.vendorName} did not go through.`
        : 'Home check requested. It is on Active Tasks.'
      onRequested(sent)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request this home check.')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div
        role="presentation"
        className="absolute inset-0"
        aria-hidden
        onClick={() => {
          if (!submitting) onClose()
        }}
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
        {loading ? (
          <p className="mt-3 text-[14px] leading-5 text-[#4b5563]">Finding a contractor for this property.</p>
        ) : vendorName ? (
          <>
            <p className="mt-3 text-[16px] font-semibold text-[#0d0f11]">{vendorName}</p>
            <p className="mt-2 text-[14px] leading-5 text-[#4b5563]">
              {homeCheckRequestVendorCopy(vendorName)}
            </p>
          </>
        ) : null}
        {error ? <p className="mt-3 text-[13px] leading-5 text-[#b91c1c]">{error}</p> : null}
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="pd-btn pd-btn-ghost rounded-[10px] px-4 py-2.5 text-[13px] font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!vendor || loading || submitting}
            onClick={() => void onContinue()}
            className="pd-btn pd-btn-primary rounded-[10px] px-4 py-2.5 text-[13px] font-semibold disabled:opacity-60"
          >
            {submitting ? 'Continuing…' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
