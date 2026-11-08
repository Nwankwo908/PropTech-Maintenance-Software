import { useEffect, useId, useState } from 'react'
import { getActiveLandlordId } from '@/lib/activeLandlord'
import {
  buildVendorVerificationRequestSms,
  vendorVerificationRequestSuccessMessage,
  vendorVerificationRequestTitle,
  type VendorVerificationRequestItemId,
} from '@shared/sms/vendorInsuranceRequestSms'
import { supabase } from '@/lib/supabase'
import { uloAppOrigin } from '@/lib/uloAppUrl'

function previewRenewalLink(): string {
  const origin = uloAppOrigin().replace(/\/$/, '')
  return origin ? `${origin}/v/…` : 'https://www.ulohome.io/v/…'
}

export function RequestVendorInsuranceModal({
  open,
  vendorName,
  itemId = 'coi_coverage',
  saving = false,
  onClose,
  onApprove,
}: {
  open: boolean
  vendorName: string
  itemId?: VendorVerificationRequestItemId
  saving?: boolean
  onClose: () => void
  /** Returns true when the SMS was sent successfully. */
  onApprove: () => Promise<boolean>
}) {
  const titleId = useId()
  const [companyName, setCompanyName] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const who = vendorName.trim() || 'this vendor'
  const title = vendorVerificationRequestTitle(itemId)
  const message = buildVendorVerificationRequestSms({
    itemId,
    vendorLabel: who === 'this vendor' ? 'there' : who,
    companyName,
    renewalLink: previewRenewalLink(),
  })

  useEffect(() => {
    if (!open) {
      setSent(false)
      return
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, saving])

  useEffect(() => {
    if (!open) return
    const landlordId = getActiveLandlordId()
    if (!supabase || !landlordId) return
    let cancelled = false
    void supabase
      .from('landlords')
      .select('name')
      .eq('id', landlordId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const name = typeof data?.name === 'string' ? data.name.trim() : ''
        setCompanyName(name || null)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="presentation"
        className="absolute inset-0"
        aria-hidden
        onClick={() => {
          if (!saving) onClose()
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(90vh,760px)] w-full max-w-lg flex-col overflow-y-auto rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1)]"
      >
        {sent ? (
          <>
            <h2 id={titleId} className="text-[18px] font-semibold leading-7 text-[#0a0a0a]">
              Message sent
            </h2>
            <div className="mt-4 rounded-[10px] border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3">
              <p className="text-[14px] leading-5 text-[#166534]">
                {vendorVerificationRequestSuccessMessage(itemId, who)}
              </p>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="sa-press inline-flex h-9 items-center rounded-[10px] bg-[#186179] px-4 text-[13px] font-medium text-white hover:bg-[#145066]"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id={titleId} className="text-[18px] font-semibold leading-7 text-[#0a0a0a]">
              {title}
            </h2>

            <div className="mt-4 flex flex-col gap-3">
              <p className="text-[13px] font-normal leading-5 text-[#0a0a0a]">Message preview</p>
              <section
                className="rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3"
                aria-label="SMS preview"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#6a7282]">
                  SMS
                </p>
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-[#364153]">
                  {message}
                </p>
              </section>
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={onClose}
                className="sa-press inline-flex h-9 items-center rounded-[10px] border border-[#e5e7eb] bg-white px-4 text-[13px] font-medium text-[#364153] hover:bg-[#f9fafb] disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void (async () => {
                    const ok = await onApprove()
                    if (ok) setSent(true)
                  })()
                }}
                className="sa-press inline-flex h-9 items-center rounded-[10px] bg-[#186179] px-4 text-[13px] font-medium text-white hover:bg-[#145066] disabled:pointer-events-none disabled:opacity-50"
              >
                {saving ? 'Sending…' : 'Approve'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
